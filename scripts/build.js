const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const ejs = require('ejs');

const root = path.join(__dirname, '..');

function filesUnder(directory, extension) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) return filesUnder(filePath, extension);
    return entry.isFile() && filePath.endsWith(extension) ? [filePath] : [];
  });
}

const javascriptFiles = filesUnder(path.join(root, 'src'), '.js');
const templateFiles = filesUnder(path.join(root, 'src', 'views'), '.ejs');

for (const file of javascriptFiles) {
  execFileSync(process.execPath, ['--check', file], { stdio: 'inherit' });
}

for (const file of templateFiles) {
  ejs.compile(fs.readFileSync(file, 'utf8'), { filename: file });
}

console.log(`Build checks passed: ${javascriptFiles.length} JavaScript files, ${templateFiles.length} EJS templates.`);
