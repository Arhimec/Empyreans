const axios = require('axios');
const fs = require('fs');

const COLLECTION = "EMP-897b49"; // Change to your target collection ID
const PAGE_SIZE = 10000;           // Pagination page size
const OUTPUT_FILE = "traits.json";

async function fetchAllNFTs(collection) {
  let allNFTs = [];
  let from = 0;

  while (true) {
    const url = `https://api.multiversx.com/nfts`;
    const params = {
      collection,
      size: PAGE_SIZE,
      from
    };
    try {
      const response = await axios.get(url, { params, timeout: 20000 });
      const nfts = response.data;
      if (!Array.isArray(nfts) || nfts.length === 0) break;
      allNFTs = allNFTs.concat(nfts);
      if (nfts.length < PAGE_SIZE) break;
      from += PAGE_SIZE;
      console.log(`Fetched ${allNFTs.length} NFTs so far...`);
    } catch (err) {
      console.error(`Error fetching NFTs from ${from}: ${err.message}`);
      break;
    }
  }

  return allNFTs;
}

function aggregateTraits(nfts) {
  const results = {};
  const maxPerCategory = {};
  let totalNFTs = nfts.length;

  nfts.forEach((nft, index) => {
    // Defensive: check metadata and attributes
    const attrs = nft.metadata?.attributes;
    if (!Array.isArray(attrs)) return;

    // Filter attributes containing '_Head' in trait_type
    const filteredAttrs = attrs.filter(attr => attr.trait_type && attr.trait_type.includes('_Head'));

    filteredAttrs.forEach(attr => {
      const baseCategory = attr.trait_type.split('_Head')[0];
      const value = attr.value ?? "undefined";

      if (!results[baseCategory]) results[baseCategory] = {};
      results[baseCategory][value] = (results[baseCategory][value] || 0) + 1;

      maxPerCategory[baseCategory] = Math.max(maxPerCategory[baseCategory] || 0, results[baseCategory][value]);
    });
  });

  return {
    counts: results,
    maxPerCategory,
    totalNFTs
  };
}

async function main() {
  console.log(`Fetching NFTs for collection: ${COLLECTION}...`);
  const nfts = await fetchAllNFTs(COLLECTION);
  console.log(`Total NFTs fetched: ${nfts.length}`);

  console.log(`Aggregating trait counts...`);
  const aggregatedData = aggregateTraits(nfts);

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(aggregatedData, null, 2));
  console.log(`Aggregated trait data saved to ${OUTPUT_FILE}`);
}

main();
