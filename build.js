import { $ } from 'bun';
import pkg from './package.json';

const targets = [
  { entrypoint: 'src/cli/index.ts', outfile: 'dist/azdev-darwin-arm64', target: 'bun-darwin-arm64' },
  { entrypoint: 'src/cli/index.ts', outfile: 'dist/azdev-linux-x64',   target: 'bun-linux-x64'   },
];

// package.json is the single source of truth for the version; the binaries get it
// baked in so they don't have to carry package.json around.
const define = `BUILD_VERSION=${JSON.stringify(pkg.version)}`;

async function build() {
  console.log(`Building azdev v${pkg.version}...`);

  for (const { entrypoint, outfile, target } of targets) {
    console.log(`Building ${outfile} (${target})...`);
    await $`bun build --compile --define ${define} --minify --bytecode --target=${target} ${entrypoint} --outfile ${outfile}`;
    console.log(`Built: ${outfile}`);
  }

  console.log('Build complete!');
}

// A failing target must fail the build — a release job that keeps going would
// publish a missing or stale binary.
build().catch((err) => {
  console.error(`Build failed: ${err.message}`);
  process.exit(1);
});
