const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const configPath = path.join(__dirname, "release.json");
const releaseNotesDir = path.join(__dirname, "release-notes");
const outputDir = path.join(__dirname, "vsix");
const packagePath = path.join(root, "package.json");
const ignoreFilePath = path.join(root, "scripts", "vsce-files.txt");
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

function assertBilingualReleaseNotes(markdown, filePath) {
	const separators = [...markdown.matchAll(/^[ \t]*---[ \t]*$/gmu)];
	const separator = separators.at(-1);
	if (!separator || separator.index === undefined) {
		throw new Error(`${filePath} must place English release notes after a \"---\" separator.`);
	}

	const chineseBody = markdown.slice(0, separator.index);
	const englishBody = markdown.slice(separator.index + separator[0].length);
	if (!/[\p{Script=Han}]/u.test(chineseBody)) {
		throw new Error(`${filePath} must contain Chinese release notes.`);
	}
	if ((englishBody.match(/\b[A-Za-z]{3,}\b/g) || []).length < 3) {
		throw new Error(`${filePath} must contain English release notes.`);
	}
}

function copyIfExists(from, to) {
	if (fs.existsSync(from)) {
		fs.cpSync(from, to, { recursive: true });
	}
}

const config = readJson(configPath);
const sourcePackage = readJson(packagePath);
const publicVersion =
	process.env.OPENCODEUI_PUBLIC_VERSION || config.publicVersion;
const localVersion = sourcePackage.version;
const releaseNotesPath = path.join(releaseNotesDir, `${publicVersion}.md`);

assertVersion(publicVersion, "Marketplace public version");
assertVersion(localVersion, "package.json version");

if (!fs.existsSync(releaseNotesPath)) {
	throw new Error(`Missing bilingual release notes: ${releaseNotesPath}`);
}
const releaseNotes = fs.readFileSync(releaseNotesPath, "utf8");
assertBilingualReleaseNotes(releaseNotes, releaseNotesPath);

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

if (!fs.existsSync(ignoreFilePath)) {
	throw new Error("Missing scripts/vsce-files.txt packaging boundary.");
}

fs.mkdirSync(outputDir, { recursive: true });
const outputBaseName = `${sourcePackage.name}-${publicVersion}`;
const outputPath = path.join(outputDir, `${outputBaseName}.vsix`);
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
		[
			vsceBin,
			"package",
			"--no-dependencies",
			"--ignoreFile",
			ignoreFilePath,
			"--out",
			outputPath,
		],
		{
			cwd: staging,
			stdio: "inherit",
		},
	);

	const manifest = {
		publicVersion,
		localVersion,
		asset: path.relative(root, outputPath).replace(/\\/g, "/"),
		releaseNotes: path.relative(root, releaseNotesPath).replace(/\\/g, "/"),
	};
	fs.writeFileSync(
		path.join(outputDir, `${outputBaseName}.json`),
		`${JSON.stringify(manifest, null, 2)}\n`,
	);
	console.log(`GitHub VSIX: ${outputPath}`);
	console.log(`Built from local package version ${localVersion}.`);
} finally {
	fs.rmSync(staging, { recursive: true, force: true });
}
