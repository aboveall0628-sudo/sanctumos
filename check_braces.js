const fs = require('fs');
const content = fs.readFileSync('script.js', 'utf8');
let balance = 0;
for (let i = 0; i < content.length; i++) {
    if (content[i] === '{') balance++;
    if (content[i] === '}') balance--;
}
console.log('Final balance:', balance);
if (balance !== 0) {
    console.log('Unbalanced braces!');
}
