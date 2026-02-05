#!/usr/bin/env node
/**
 * Mirror Milady NFT metadata locally for development and production.
 *
 * Usage:
 *   node scripts/mirror-milady-metadata.mjs
 *   node scripts/mirror-milady-metadata.mjs --start=0 --end=100   # Mirror subset
 *   node scripts/mirror-milady-metadata.mjs --force               # Re-fetch all
 *
 * The metadata is saved to public/milady/ and served by Vite.
 */

import { mkdir, writeFile, access } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "..");

const MILADY_METADATA_BASE = "https://www.miladymaker.net/milady/json";
const MILADY_IMAGE_BASE = "https://www.miladymaker.net/milady";

const DEFAULT_OPTIONS = {
    start: 0,
    end: 9999,
    concurrency: 8,
    output: path.join(PROJECT_ROOT, "public", "milady"),
    force: false
};

function parseArgs(argv) {
    const options = { ...DEFAULT_OPTIONS };
    argv.forEach((arg) => {
        if (!arg.startsWith("--")) return;
        const [flag, rawValue] = arg.split("=");
        const value = rawValue ?? "";
        switch (flag) {
            case "--start":
                options.start = Number(value);
                break;
            case "--end":
                options.end = Number(value);
                break;
            case "--concurrency":
                options.concurrency = Number(value);
                break;
            case "--output":
                options.output = value || options.output;
                break;
            case "--force":
                options.force = true;
                break;
            default:
                break;
        }
    });
    if (!Number.isFinite(options.start) || options.start < 0) {
        throw new Error("start must be a non-negative number");
    }
    if (!Number.isFinite(options.end) || options.end < options.start) {
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

async function fetchMetadata(tokenId) {
    const url = `${MILADY_METADATA_BASE}/${tokenId}`;
    const response = await fetch(url, { headers: { Accept: "application/json" } });
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }
    return response.json();
}

async function mirrorToken({ tokenId, outputDir, force }) {
    const tokenStr = tokenId.toString();
    const filePath = path.join(outputDir, `${tokenStr}.json`);
    if (!force && (await fileExists(filePath))) {
        return { status: "skipped", tokenId };
    }
    const metadata = await fetchMetadata(tokenStr);
    if (!metadata.image && !metadata.image_url) {
        metadata.image = `${MILADY_IMAGE_BASE}/${tokenStr}.png`;
    }
    await writeFile(filePath, JSON.stringify(metadata, null, 2));
    return { status: "written", tokenId };
}

async function run() {
    const options = parseArgs(process.argv.slice(2));
    await mkdir(options.output, { recursive: true });
    const total = options.end - options.start + 1;
    console.log(`Mirroring Milady metadata to ${options.output}`);
    console.log(`Range: ${options.start} – ${options.end} (${total} tokens)`);
    console.log(`Mode: ${options.force ? "force-refresh" : "fill-missing"}, concurrency ${options.concurrency}`);

    const queue = [];
    for (let id = options.start; id <= options.end; id++) {
        queue.push(id);
    }

    const summary = { written: 0, skipped: 0, failed: 0 };

    async function worker(workerId) {
        while (queue.length) {
            const nextId = queue.shift();
            if (nextId === undefined) return;
            try {
                const result = await mirrorToken({ tokenId: nextId, outputDir: options.output, force: options.force });
                if (result.status === "written") summary.written += 1;
                else summary.skipped += 1;
                if ((summary.written + summary.skipped + summary.failed) % 200 === 0) {
                    console.log(`Worker ${workerId}: processed ${summary.written + summary.skipped + summary.failed}/${total}`);
                }
            } catch (err) {
                summary.failed += 1;
                console.error(`Token #${nextId} failed: ${err.message}`);
            }
        }
    }

    const workers = Array.from({ length: options.concurrency }, (_, idx) => worker(idx + 1));
    await Promise.all(workers);

    console.log("Mirror complete:", summary);
    if (summary.failed > 0) {
        process.exitCode = 1;
    }
}

run().catch((error) => {
    console.error("Mirror script failed", error);
    process.exit(1);
});
