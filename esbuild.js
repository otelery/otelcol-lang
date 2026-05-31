const esbuild = require("esbuild");
const { execSync } = require("child_process");

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

/** @type {import('esbuild').Plugin} */
const problemMatcherPlugin = {
  name: "esbuild-problem-matcher",
  setup(build) {
    build.onStart(() => console.log("[watch] build started"));
    build.onEnd((result) => {
      result.errors.forEach(({ text, location }) => {
        console.error(`✘ [ERROR] ${text}`);
        console.error(`    ${location.file}:${location.line}:${location.column}:`);
      });
      console.log("[watch] build finished");
    });
  },
};

/** @type {import('esbuild').BuildOptions} */
const shared = {
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "node18",
  external: ["vscode"],
  minify: production,
  sourcemap: !production,
  sourcesContent: false,
  logLevel: "silent",
  plugins: [problemMatcherPlugin],
};

async function main() {
  const extension = await esbuild.context({
    ...shared,
    entryPoints: ["src/extension/extension.ts"],
    outfile: "dist/extension/extension.js",
  });

  const server = await esbuild.context({
    ...shared,
    entryPoints: ["src/server/server.ts"],
    outfile: "dist/server/server.js",
  });

  if (watch) {
    await Promise.all([extension.watch(), server.watch()]);
  } else {
    await extension.rebuild();
    await extension.dispose();
    await server.rebuild();
    await server.dispose();
    execSync("node scripts/copy-schemas.mjs --outDir=dist", { stdio: "inherit" });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
