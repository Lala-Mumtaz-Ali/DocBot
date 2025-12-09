
const fs = require('fs');
const path = require('path');

console.log("CWD:", process.cwd());

const uploadsDir = path.join(process.cwd(), 'public', 'uploads');
console.log("Uploads Dir:", uploadsDir);

if (!fs.existsSync(uploadsDir)) {
    console.log("Uploads dir does not exist!");
} else {
    console.log("Uploads dir exists.");
    const files = fs.readdirSync(uploadsDir);
    console.log("Files found:", files);

    files.forEach(file => {
        const fullPath = path.join(uploadsDir, file);
        console.log(`Checking file: ${file}`);
        console.log(`  Full Path: ${fullPath}`);
        console.log(`  Exists: ${fs.existsSync(fullPath)}`);
    });
}
