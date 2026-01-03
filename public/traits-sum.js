// Save this as trait-counter.js
const axios = require('axios');
const fs = require('fs');
const API = 'https://api.multiversx.com/nfts';
const COLLECTION = 'EMP-897b49';
const output = 'traits.json';

(async () => {
  let results = {}, page = 0, total = [];
  while (true) {
    const res = await axios.get(API, { params: { collection: COLLECTION, size: 100, from: page * 100 } });
    if (res.data.length === 0) break;
    total.push(...res.data);
    if (res.data.length < 100) break;
    page += 1;
  }
  for (const nft of total) {
    let attributes = [];
    try {
      if (nft.metadata && nft.metadata.startsWith('http')) {
        const meta = await axios.get(nft.metadata, { timeout: 8000 });
        attributes = meta.data.attributes || [];
      }
    } catch {}
    for (const attr of attributes) {
      const type = attr.trait_type || attr.type;
      const value = attr.value;
      if (!type || value === undefined) continue;
      results[type] = results[type] || {};
      results[type][value] = (results[type][value] || 0) + 1;
    }
  }
  fs.writeFileSync(output, JSON.stringify(results, null, 2));
  console.log('Trait summary written to', output);
})();
