import { $ } from 'bun';

const targets = [
  { entrypoint: 'src/cli/index.ts', outfile: 'dist/azdev-darwin-arm64', target: 'bun-darwin-arm64' },
  { entrypoint: 'src/cli/index.ts', outfile: 'dist/azdev-linux-x64',   target: 'bun-linux-x64'   },
];

async function build() {
  console.log('Starting build...');

  for (const { entrypoint, outfile, target } of targets) {
    console.log(`Building ${outfile} (${target})...`);
    try {
      await $`bun build --compile --target=${target} ${entrypoint} --outfile ${outfile}`;
      console.log(`Built: ${outfile}`);
    } catch (error) {
      console.error(`Error building ${outfile}: ${error.message}`);
    }
  }

  console.log('Build complete!');
}

build().catch(err => {
  console.error(`Build failed: ${err.message}`);
  process.exit(1);
});
