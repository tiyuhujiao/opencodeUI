const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const configPath = path.join(__dirname, "release.json");
const outputDir = path.join(__dirname, "vsix");
const packagePath = path.join(root, "package.json");
const vsceBin = path.join(root, "node_modules", "@vscode", "vsce", "vsce");

function readJson(filePath) {
	return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function assertVersion(value, label) {
	if (
		typeof value !== "string" ||
		!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(value)
	) {
		throw new Error(`${label} must be a semver string.`);
	}
}

function copyIfExists(from, to) {
	if (fs.existsSync(from)) {
		fs.cpSync(from, to, { recursive: true });
	}
}

const config = readJson(configPath);
const sourcePackage = readJson(packagePath);
const publicVersion = config.publicVersion;
const localVersion = sourcePackage.version;

assertVersion(publicVersion, "github-upload/release.json publicVersion");
assertVersion(localVersion, "package.json version");

for (const required of ["out", "media"]) {
	if (!fs.existsSync(path.join(root, required))) {
		throw new Error(
			`Missing ${required}/. Run npm run build before npm run package:github.`,
		);
	}
}

if (!fs.existsSync(vsceBin)) {
	throw new Error("Missing local @vscode/vsce dependency. Run npm ci first.");
}

fs.mkdirSync(outputDir, { recursive: true });
const outputPath = path.join(outputDir, `opencode-ui-${publicVersion}.vsix`);
fs.rmSync(outputPath, { force: true });

const staging = fs.mkdtempSync(
	path.join(os.tmpdir(), "opencode-ui-github-upload-"),
);
try {
	const publicPackage = {
		...sourcePackage,
		version: publicVersion,
		scripts: { ...sourcePackage.scripts },
	};
	delete publicPackage.scripts["vscode:prepublish"];

	fs.writeFileSync(
		path.join(staging, "package.json"),
		`${JSON.stringify(publicPackage, null, 2)}\n`,
	);
	copyIfExists(
		path.join(root, ".vscodeignore"),
		path.join(staging, ".vscodeignore"),
	);
	copyIfExists(path.join(root, "README.md"), path.join(staging, "README.md"));
	copyIfExists(
		path.join(root, "README.zh-CN.md"),
		path.join(staging, "README.zh-CN.md"),
	);
	copyIfExists(path.join(root, "LICENSE"), path.join(staging, "LICENSE"));
	fs.cpSync(path.join(root, "out"), path.join(staging, "out"), {
		recursive: true,
	});
	fs.cpSync(path.join(root, "media"), path.join(staging, "media"), {
		recursive: true,
	});

	execFileSync(
		process.execPath,
		[vsceBin, "package", "--no-dependencies", "--out", outputPath],
		{
			cwd: staging,
			stdio: "inherit",
		},
	);

	const manifest = {
		publicVersion,
		localVersion,
		asset: path.relative(root, outputPath).replace(/\\/g, "/"),
	};
	fs.writeFileSync(
		path.join(outputDir, `opencode-ui-${publicVersion}.json`),
		`${JSON.stringify(manifest, null, 2)}\n`,
	);
	console.log(`GitHub VSIX: ${outputPath}`);
	console.log(`Built from local package version ${localVersion}.`);
} finally {
	fs.rmSync(staging, { recursive: true, force: true });
}
