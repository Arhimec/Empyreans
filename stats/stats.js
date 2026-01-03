const express = require('express');
const fetch = require('node-fetch');
const fs = require('fs');

const app = express();
const PORT = 3013;
const COLLECTION = 'EMP-897b49';
const MAX_NFTS = 10000;
const CACHE_FILE = __dirname + '/statsCache.json';
const TRAITS_FILE = __dirname + '/all-traits.json';

let cachedStats = {
  updated: null,
  totalMinted: 0,
  totalSupply: MAX_NFTS,
  allNfts: [],
  missingTraits: []
};

let traitCategories = [];

// Load cached stats from file at startup
if (fs.existsSync(CACHE_FILE)) {
  try {
    cachedStats = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
    console.log('Loaded cache from statsCache.json');
  } catch (err) {
    console.error('Failed to read/parse cache file:', err);
  }
}

// Fetch collection traits and save to file
async function fetchTraitCategories() {
  try {
    const collectionResp = await fetch(`https://api.multiversx.com/collections/${COLLECTION}`);
    const collectionData = await collectionResp.json();

    if (collectionData.traits) {
      const traitsObj = JSON.parse(collectionData.traits);
      traitCategories = Object.keys(traitsObj);

      fs.writeFileSync(TRAITS_FILE, JSON.stringify(traitsObj, null, 2), 'utf-8');
      console.log('Saved all traits to all-traits.json');
    } else {
      traitCategories = [];
      console.warn('No traits field found on collection data');
    }
  } catch (err) {
    console.error('Failed to fetch or save collection traits:', err);
  }
}

async function refreshStats() {
  try {
    if (traitCategories.length === 0) {
      await fetchTraitCategories();
    }

    const mintedResp = await fetch(`https://api.multiversx.com/nfts/count?collection=${COLLECTION}`);
    cachedStats.totalMinted = Number(await mintedResp.text());
    cachedStats.totalSupply = MAX_NFTS;

    const nftsResp = await fetch(`https://api.multiversx.com/collections/${COLLECTION}/nfts?size=${MAX_NFTS}`);
    const nfts = await nftsResp.json();

    let allNfts = [];
    let missingTraits = [];

    for (const nft of nfts) {
      let attrs = {};
      try {
        if (nft.attributes) {
          const decoded = Buffer.from(nft.attributes, 'base64').toString('utf-8');
          decoded.split(';').forEach(pair => {
            const [k, v] = pair.split(':');
            if (k && v && traitCategories.includes(k.trim())) {
              attrs[k.trim()] = v.trim();
            }
          });
        }
      } catch {}

      let nftInfo = {
        token_id: nft.identifier,
        image: nft.media?.[0]?.url || '',
        ...attrs
      };

      allNfts.push(nftInfo);

      if (!attrs['_Head'] || !attrs['Astronaut']) {
        missingTraits.push({
          token_id: nft.identifier,
          image: nft.media?.[0]?.url || '',
          reason: [
            !attrs['_Head'] ? 'Missing _Head' : '',
            !attrs['Astronaut'] ? 'Missing Astronaut' : ''
          ].filter(Boolean).join(', ')
        });
      }
    }

    cachedStats.allNfts = allNfts;
    cachedStats.missingTraits = missingTraits;
    cachedStats.updated = new Date().toISOString();

    fs.writeFile(CACHE_FILE, JSON.stringify(cachedStats, null, 2), err => {
      if (err) console.error('Failed to write cache file:', err);
    });

  } catch (err) {
    console.error('Error updating stats', err);
  }
}

refreshStats();
setInterval(refreshStats, 30000);

app.use(express.static(__dirname));

app.get('/api/stats', (req, res) => {
  fs.readFile(CACHE_FILE, 'utf-8', (err, data) => {
    if (err) {
      console.error('Failed to read cache file on API request:', err);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
    try {
      const stats = JSON.parse(data);
      res.json(stats);
    } catch (e) {
      console.error('Failed to parse cache on API request:', e);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  });
});

app.listen(PORT, '0.0.0.0', () => console.log(`Stats server running on http://0.0.0.0:${PORT}`));
