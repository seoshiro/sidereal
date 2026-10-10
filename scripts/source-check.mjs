import fs from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const paths=execFileSync('git',['ls-files','--cached','--others','--exclude-standard'],{encoding:'utf8'}).trim().split(/\r?\n/);
const patterns=[/github_pat_[A-Za-z0-9_]{20,}/,/gh[pousr]_[A-Za-z0-9]{30,}/,/AKIA[0-9A-Z]{16}/,/AIza[0-9A-Za-z_-]{30,}/,/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/];
let scanned=0;const findings=[];
for(const path of paths){if(path.endsWith('.png'))continue;let text;try{text=await fs.readFile(path,'utf8');}catch{continue;}scanned++;if(path!=='scripts/source-check.mjs'&&patterns.some(p=>p.test(text)))findings.push(path);}
assert.deepEqual(findings,[],'Potential credential in source files: '+findings.join(', '));
const audioDiff=execFileSync('git',['diff','53e17d656cf3cc14afcaf69c6ae1ef120ee623cc','--','src/audio.ts'],{encoding:'utf8'});assert.equal(audioDiff,'');
for(const file of ['README.md','docs/QA.md']){const text=await fs.readFile(file,'utf8');for(const [,link] of text.matchAll(/\]\(([^)#]+)(?:#[^)]*)?\)/g)){if(link.startsWith('https:'))continue;const base=file.includes('/')?file.slice(0,file.lastIndexOf('/')+1):'';await fs.access(base+link);}}
console.log(JSON.stringify({textFilesScanned:scanned,credentialFindings:findings,audioKernelUnchanged:true,documentationLinks:'valid'},null,2));
