#!/usr/bin/env node
/**
 * Mirror NFT metadata locally for development and production.
 * Supports multiple collections with configurable metadata sources.
 *
 * Usage:
 *   node scripts/mirror-nft-metadata.mjs --collection=milady
 *   node scripts/mirror-nft-metadata.mjs --collection=remilio --start=0 --end=100
 *   node scripts/mirror-nft-metadata.mjs --collection=all     # Mirror all known collections
 *   node scripts/mirror-nft-metadata.mjs --force              # Re-fetch all
 *
 * The metadata is saved to app/collections/{collection}/ and served statically.
 */

import { mkdir, writeFile, access } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "..");

// Collection configurations
const COLLECTIONS = {
    milady: {
        name: "Milady Maker",
        address: "0x5af0d9827e0c53e4799bb226655a1de152a425a5",
        metadataUrl: (id) => `https://www.miladymaker.net/milady/json/${id}`,
        imageUrl: (id) => `https://www.miladymaker.net/milady/${id}.png`,
        startId: 0,
        maxSupply: 9999,
    },
    remilio: {
        name: "Redacted Remilio Babies",
        address: "0xD3D9ddd0CF0A5F0BFB8f7fcEAe075DF687eAEBaB",
        metadataUrl: (id) => `https://remilio.org/remilio/json/${id}`,
        imageUrl: (id) => `https://remilio.org/remilio/${id}.png`,
        startId: 1,
        maxSupply: 10000,
    },
    // Add more collections here as needed
};

const DEFAULT_OPTIONS = {
    collection: null,
    start: 0,
    startOverridden: false, // Track if --start was explicitly provided
    end: null, // Will use collection's maxSupply if not specified
    concurrency: 8,
    outputBase: path.join(PROJECT_ROOT, "public", "collections"),
    force: false,
};

function parseArgs(argv) {
    const options = { ...DEFAULT_OPTIONS };
    argv.forEach((arg) => {
        if (!arg.startsWith("--")) return;
        const [flag, rawValue] = arg.split("=");
        const value = rawValue ?? "";
        switch (flag) {
            case "--collection":
                options.collection = value.toLowerCase();
                break;
            case "--start":
                options.start = Number(value);
                options.startOverridden = true;
                break;
            case "--end":
                options.end = Number(value);
                break;
            case "--concurrency":
                options.concurrency = Number(value);
                break;
            case "--output":
                options.outputBase = value || options.outputBase;
                break;
            case "--force":
                options.force = true;
                break;
            default:
                break;
        }
    });

    if (!options.collection) {
        console.log("Available collections:", Object.keys(COLLECTIONS).join(", "), "+ 'all'");
        throw new Error("--collection is required");
    }

    if (!Number.isFinite(options.start) || options.start < 0) {
        throw new Error("start must be a non-negative number");
    }
    if (options.end !== null && (!Number.isFinite(options.end) || options.end < options.start)) {
        throw new Error("end must be >= start");
    }
    if (!Number.isFinite(options.concurrency) || options.concurrency <= 0) {
        throw new Error("concurrency must be a positive number");
    }
    return options;
}

async function fileExists(filePath) {
    try {
        await access(filePath);
        return true;
    } catch {
        return false;
    }
}

async function fetchMetadata(url) {
    const response = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(30000), // 30s timeout
    });
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }
    return response.json();
}

async function mirrorToken({ tokenId, collection, outputDir, force }) {
    const tokenStr = tokenId.toString();
    const filePath = path.join(outputDir, `${tokenStr}.json`);

    if (!force && (await fileExists(filePath))) {
        return { status: "skipped", tokenId };
    }

    const metadataUrl = collection.metadataUrl(tokenStr);
    const metadata = await fetchMetadata(metadataUrl);

    // Ensure image URL is set
    if (!metadata.image && !metadata.image_url) {
        metadata.image = collection.imageUrl(tokenStr);
    }

    await writeFile(filePath, JSON.stringify(metadata, null, 2));
    return { status: "written", tokenId };
}

async function mirrorCollection(collectionKey, options) {
    const collection = COLLECTIONS[collectionKey];
    if (!collection) {
        throw new Error(`Unknown collection: ${collectionKey}`);
    }

    const outputDir = path.join(options.outputBase, collectionKey);
    await mkdir(outputDir, { recursive: true });

    // Use collection's startId if options.start wasn't explicitly set (still 0)
    const start = options.startOverridden ? options.start : (collection.startId ?? 0);
    const end = options.end ?? collection.maxSupply;
    const total = end - start + 1;

    console.log(`\n=== Mirroring ${collection.name} ===`);
    console.log(`Output: ${outputDir}`);
    console.log(`Range: ${start} – ${end} (${total} tokens)`);
    console.log(`Mode: ${options.force ? "force-refresh" : "fill-missing"}, concurrency ${options.concurrency}`);

    const queue = [];
    for (let id = start; id <= end; id++) {
        queue.push(id);
    }

    const summary = { written: 0, skipped: 0, failed: 0 };

    async function worker(workerId) {
        while (queue.length) {
            const nextId = queue.shift();
            if (nextId === undefined) return;
            try {
                const result = await mirrorToken({
                    tokenId: nextId,
                    collection,
                    outputDir,
                    force: options.force
                });
                if (result.status === "written") summary.written += 1;
                else summary.skipped += 1;

                const processed = summary.written + summary.skipped + summary.failed;
                if (processed % 500 === 0) {
                    console.log(`[${collectionKey}] Progress: ${processed}/${total} (${summary.written} written, ${summary.skipped} skipped, ${summary.failed} failed)`);
                }
            } catch (err) {
                summary.failed += 1;
                if (summary.failed <= 10) {
                    console.error(`[${collectionKey}] Token #${nextId} failed: ${err.message}`);
                } else if (summary.failed === 11) {
                    console.error(`[${collectionKey}] Suppressing further error messages...`);
                }
            }
        }
    }

    const workers = Array.from({ length: options.concurrency }, (_, idx) => worker(idx + 1));
    await Promise.all(workers);

    console.log(`[${collectionKey}] Complete:`, summary);
    return summary;
}

async function run() {
    const options = parseArgs(process.argv.slice(2));

    const collectionsToMirror = options.collection === "all"
        ? Object.keys(COLLECTIONS)
        : [options.collection];

    const results = {};
    let collectionFailed = false;

    for (const collectionKey of collectionsToMirror) {
        try {
            results[collectionKey] = await mirrorCollection(collectionKey, options);
        } catch (err) {
            console.error(`Failed to mirror ${collectionKey}:`, err.message);
            collectionFailed = true;
        }
    }

    console.log("\n=== Summary ===");
    let totalTokens = 0;
    let totalFailed = 0;
    for (const [key, summary] of Object.entries(results)) {
        console.log(`${key}: ${summary.written} written, ${summary.skipped} skipped, ${summary.failed} failed`);
        totalTokens += summary.written + summary.skipped + summary.failed;
        totalFailed += summary.failed;
    }

    // Only fail if >1% of tokens failed or a collection completely failed to start
    const failureRate = totalTokens > 0 ? (totalFailed / totalTokens) * 100 : 0;
    if (collectionFailed) {
        console.error("One or more collections completely failed to mirror");
        process.exitCode = 1;
    } else if (failureRate > 1) {
        console.error(`Failure rate ${failureRate.toFixed(2)}% exceeds 1% threshold`);
        process.exitCode = 1;
    } else if (totalFailed > 0) {
        console.log(`${totalFailed} tokens failed (${failureRate.toFixed(2)}%) - within acceptable threshold`);
    }
}

run().catch((error) => {
    console.error("Mirror script failed", error);
    process.exit(1);
});
