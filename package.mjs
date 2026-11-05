import {readFileSync, copyFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, existsSync} from 'node:fs';
import {join, resolve, dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';

const directory = fileURLToPath(new URL('.', import.meta.url));
const metadata = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
const output = resolve(process.argv[2] || join(directory, 'dist', `${metadata.name}-${metadata.version}.vsix`));
if (existsSync(output)) throw new Error('Файл уже существует: ' + output);
const xml = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
const staging = mkdtempSync(join(tmpdir(), 'geometry-vsix-'));
try {
    mkdirSync(join(staging, 'extension'));
    copyFileSync(join(directory, 'docs/INSTALL.md'), join(staging, 'extension', 'README.md'));
    for (const name of ['package.json', 'extension.cjs', 'diagrams.cjs', 'bindings.cjs', 'analysis.cjs', 'analysis-session.cjs', 'analysis-webview.js', 'webview.cjs', 'webview.js', 'webview.css']) {
        copyFileSync(join(directory, name), join(staging, 'extension', name));
    }
    writeFileSync(join(staging, 'extension.vsixmanifest'), `<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011">
<Metadata><Identity Language="en-US" Id="${xml(metadata.name)}" Version="${xml(metadata.version)}" Publisher="${xml(metadata.publisher)}"/>
<DisplayName>${xml(metadata.displayName)}</DisplayName><Description xml:space="preserve">${xml(metadata.description)}</Description>
<Categories>Education</Categories><Properties>
<Property Id="Microsoft.VisualStudio.Code.Engine" Value="${xml(metadata.engines.vscode)}"/>
<Property Id="Microsoft.VisualStudio.Code.ExtensionKind" Value="workspace"/>
</Properties></Metadata>
<Installation><InstallationTarget Id="Microsoft.VisualStudio.Code"/></Installation><Dependencies/>
<Assets><Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true"/>
<Asset Type="Microsoft.VisualStudio.Services.Content.Details" Path="extension/README.md" Addressable="true"/></Assets>
</PackageManifest>`);
    writeFileSync(join(staging, '[Content_Types].xml'), `<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="json" ContentType="application/json"/>
<Default Extension="cjs" ContentType="application/javascript"/>
<Default Extension="js" ContentType="application/javascript"/>
<Default Extension="css" ContentType="text/css"/>
<Default Extension="md" ContentType="text/markdown"/>
<Default Extension="vsixmanifest" ContentType="text/xml"/>
</Types>`);
    mkdirSync(dirname(output), {recursive: true});
    execFileSync('zip', ['-qr', output, '.'], {cwd: staging, stdio: 'inherit'});
    console.log(output);
} finally {
    rmSync(staging, {recursive: true, force: true});
}
