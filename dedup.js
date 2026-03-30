const fs = require('fs');

let code = fs.readFileSync('database.js', 'utf8');
let astitva_db = [];
eval(code);

let map = new Map();
astitva_db.forEach(item => {
    map.set(item.id, item);
});

let newArr = Array.from(map.values());
let out = `const astitva_db = ${JSON.stringify(newArr, null, 2)};\n`;

fs.writeFileSync('database.js', out, 'utf8');
console.log("Successfully deduplicated database.js. Original: " + astitva_db.length + ", New: " + newArr.length);
