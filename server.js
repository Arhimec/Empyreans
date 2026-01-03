const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const bodyParser = require('body-parser');

const app = express();
const PORT = 3012;

app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

const configPath = path.join(__dirname, 'rewardsConfig.json');

const IPFS_GATEWAYS = [
  'https://cloudflare-ipfs.com/ipfs/',
  'https://ipfs.io/ipfs/',
  'https://gateway.lighthouse.storage/ipfs/'
];

function safeBase64Decode(input) {
  try {
    return Buffer.from(input, 'base64').toString('utf-8');
  } catch {
    return null;
  }
}

function normalizeAttributes(attrs) {
  if (!attrs) return [];
  if (Array.isArray(attrs)) return attrs;
  if (typeof attrs === 'object') {
    return Object.entries(attrs).map(([trait_type, value]) => ({ trait_type, value }));
  }
  return [];
}

async function fetchJsonFromIpfsPath(ipfsPath) {
  for (const gateway of IPFS_GATEWAYS) {
    const url = `${gateway}${ipfsPath}`;
    try {
      const resp = await axios.get(url, { timeout: 8000 });
      if (resp.status === 200 && resp.data) {
        return resp.data;
      }
    } catch {}
  }
  return null;
}

function getCategory(traitType) {
  if (traitType === 'Astronaut') return 'Astronaut';
  if (traitType.includes('_Head')) return traitType.split('_Head')[0];
  return traitType;
}

async function getNFTs(wallet, collection) {
  const pageSize = 25;
  let allNFTs = [];
  let from = 0;
  while (true) {
    const url = `https://api.multiversx.com/accounts/${wallet}/nfts?collection=${collection}&from=${from}&size=${pageSize}`;
    const response = await axios.get(url);
    const nfts = response.data;
    allNFTs = allNFTs.concat(nfts);
    if (nfts.length < pageSize) break;
    from += pageSize;
  }
  return allNFTs;
}

async function resolveNFTAttributes(nft) {
  const errorLog = [];

  if (nft.metadata && nft.metadata.attributes && Array.isArray(nft.metadata.attributes) && nft.metadata.attributes.length > 0) {
    return { attributes: normalizeAttributes(nft.metadata.attributes), errorLog };
  }

  if (nft.attributes && typeof nft.attributes === 'string') {
    const decoded = safeBase64Decode(nft.attributes);
    if (decoded) {
      try {
        const parsed = JSON.parse(decoded);
        if (parsed && parsed.attributes) {
          return { attributes: normalizeAttributes(parsed.attributes), errorLog };
        }
        if (Array.isArray(parsed)) {
          return { attributes: normalizeAttributes(parsed), errorLog };
        }
        errorLog.push('base64 parsed JSON has no attributes');
      } catch (_) {
        // Parse semicolon separated key:value pairs to find metadata IPFS path
        const metadataMatch = decoded.match(/metadata:([^;]+)/);
        if (metadataMatch && metadataMatch[1]) {
          const ipfsPath = metadataMatch[1];
          const ipfsJson = await fetchJsonFromIpfsPath(ipfsPath);
          if (ipfsJson) {
            if (ipfsJson.attributes) {
              return { attributes: normalizeAttributes(ipfsJson.attributes), errorLog };
            }
            if (ipfsJson.traits) {
              return { attributes: normalizeAttributes(ipfsJson.traits), errorLog };
            }
            errorLog.push('fetched IPFS metadata JSON missing attributes');
          } else {
            errorLog.push(`failed fetching IPFS metadata JSON at path ${ipfsPath}`);
          }
        } else {
          errorLog.push('base64 string not JSON and no metadata IPFS path found');
          console.log('Decoded base64 string for NFT', nft.identifier, ':', decoded);
        }
      }
    } else {
      errorLog.push('base64 decode failed for nft.attributes');
    }
  } else {
    errorLog.push('no base64 attributes string to decode');
  }

  // Try fallback uris (if any) for metadata JSON
  if (nft.uris && Array.isArray(nft.uris)) {
    for (const encodedUri of nft.uris) {
      const decodedUri = safeBase64Decode(encodedUri);
      if (!decodedUri) continue;
      for (const gateway of IPFS_GATEWAYS) {
        let url = decodedUri;
        if (decodedUri.startsWith('ipfs://')) {
          url = gateway + decodedUri.slice(7);
        }
        try {
          const resp = await axios.get(url, { timeout: 8000 });
          if (resp.status === 200 && resp.data) {
            const data = resp.data;
            if (data.attributes) {
              return { attributes: normalizeAttributes(data.attributes), errorLog };
            }
            if (data.traits) {
              return { attributes: normalizeAttributes(data.traits), errorLog };
            }
            errorLog.push(`fallback uri metadata JSON at ${url} missing attributes`);
          }
        } catch (e) {
          errorLog.push(`failed to fetch fallback uri metadata at ${url}: ${e.message}`);
        }
      }
    }
  } else {
    errorLog.push('no uris array to fetch metadata from');
  }

  // Also try fallback URLs from nft
  const fallbackUrls = [nft.originalUrl, nft.url].filter(Boolean);
  for (const url of fallbackUrls) {
    if (url && url.endsWith('.json')) {
      try {
        const resp = await axios.get(url, { timeout: 8000 });
        if (resp.status === 200) {
          const data = resp.data;
          if (data.attributes) {
            return { attributes: normalizeAttributes(data.attributes), errorLog };
          }
          if (data.traits) {
            return { attributes: normalizeAttributes(data.traits), errorLog };
          }
          errorLog.push(`fallback url JSON at ${url} missing attributes`);
        }
      } catch (e) {
        errorLog.push(`failed to fetch fallback url metadata at ${url}: ${e.message}`);
      }
    }
  }

  return { attributes: [], errorLog };
}

function readConfig() {
  if (!fs.existsSync(configPath)) fs.writeFileSync(configPath, JSON.stringify({}, null, 2));
  return JSON.parse(fs.readFileSync(configPath));
}

function saveConfig(config) {
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}

app.get('/api/all-traits/:collection', async (req, res) => {
  try {
    const { collection } = req.params;
    const url = `https://api.multiversx.com/collections/${collection}`;
    const response = await axios.get(url);
    const traits = JSON.parse(response.data.traits);

    const categoriesSet = new Set();

    Object.keys(traits).forEach(t => {
      if (t.includes('_Head') || t === 'Astronaut') {
        categoriesSet.add(getCategory(t));
      }
    });

    res.json(Array.from(categoriesSet));
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch traits', details: err.message });
  }
});

app.get('/api/config', (req, res) => {
  res.json(readConfig());
});

app.post('/api/config', (req, res) => {
  const { category, reward } = req.body;
  if (!category || reward == null) {
    return res.status(400).json({ error: 'category and reward required' });
  }
  const config = readConfig();
  config[category] = reward;
  saveConfig(config);
  res.json({ message: 'Reward saved', config });
});

app.delete('/api/config', (req, res) => {
  const { category } = req.body;
  const config = readConfig();
  if (config[category] !== undefined) {
    delete config[category];
    saveConfig(config);
    res.json({ message: 'Reward deleted', config });
  } else {
    res.status(404).json({ error: 'Category not found' });
  }
});

app.get('/api/rewards/:wallet/:collection', async (req, res) => {
  try {
    const { wallet, collection } = req.params;
    const nfts = await getNFTs(wallet, collection);
    const traitRewardsConfig = readConfig();

    const categorySums = {};
    let totalReward = 0;

    const includedNFTs = [];
    const excludedNFTs = [];

    for (const nft of nfts) {
      const { attributes, errorLog } = await resolveNFTAttributes(nft);

      const qualifyingAttrs = attributes.filter(t => t.trait_type && (t.trait_type.includes('_Head') || t.trait_type === 'Astronaut'));
      const categoriesFound = new Set(qualifyingAttrs.map(a => getCategory(a.trait_type)));

      let nftReward = 0;
      categoriesFound.forEach(cat => {
        const reward = traitRewardsConfig[cat] || 0;
        nftReward += reward;
      });

      if (categoriesFound.size > 0 && nftReward > 0) {
        includedNFTs.push({
          identifier: nft.identifier,
          name: nft.metadata?.name || nft.name,
          categories: Array.from(categoriesFound),
          reward: nftReward,
          attributes,
          errorLog,
        });
      } else {
        excludedNFTs.push({
          identifier: nft.identifier,
          name: nft.metadata?.name || nft.name,
          categories: Array.from(categoriesFound),
          errorLog,
        });
      }

      categoriesFound.forEach(cat => {
        const reward = traitRewardsConfig[cat] || 0;
        if (!categorySums[cat]) {
          categorySums[cat] = { reward: 0, count: 0 };
        }
        categorySums[cat].reward += reward;
        categorySums[cat].count += 1;
      });

      totalReward += nftReward;
    }

    res.json({ totalReward, categorySums, includedNFTs, excludedNFTs });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch NFTs', details: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
