const axios = require("axios");
const fs = require("fs");

const COLLECTION = "EMP-897b49";
const API_URL = "https://api.multiversx.com";
const OUTPUT_FILE = "./trait_counts.json";

async function fetchAllNFTs() {
    let page = 1, nfts = [], pageSize = 100;
    while (true) {
        const res = await axios.get(`${API_URL}/nfts`, {
            params: { collection: COLLECTION, size: pageSize, from: (page - 1) * pageSize }
        });
        if (res.data.length === 0) break;
        nfts = nfts.concat(res.data);
        if (res.data.length < pageSize) break;
        page++;
    }
    return nfts;
}

async function fetchMetadata(url) {
    if (!url || !url.startsWith("http")) return null;
    try {
        const res = await axios.get(url, { timeout: 10000 });
        return res.data;
    } catch (e) { return null; }
}

async function main() {
    const nfts = await fetchAllNFTs();
    const traitCounts = {};
    for (const nft of nfts) {
        let meta = nft.metadata ? nft.metadata : null;
        if (meta && typeof meta === "string" && meta.startsWith("http")) {
            meta = await fetchMetadata(meta);
        }
        if (!meta || !Array.isArray(meta.attributes)) continue;
        for (const attr of meta.attributes) {
            if (!attr.trait_type || attr.value == null) continue;
            if (!traitCounts[attr.trait_type]) traitCounts[attr.trait_type] = {};
            if (!traitCounts[attr.trait_type][attr.value]) traitCounts[attr.trait_type][attr.value] = 0;
            traitCounts[attr.trait_type][attr.value]++;
        }
    }
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(traitCounts, null, 2));
    console.log(`Trait summary saved to ${OUTPUT_FILE}`);
}

main();
