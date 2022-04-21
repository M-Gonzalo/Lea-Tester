const path = require("path");
const fs = require("fs");
const progressBar = require('progress-barjs')

const sha256File = require('sha256-file'); // https://www.npmjs.com/package/sha256-file
const gm = require("gm");


const files = [];
const imgFolder = path.join(__dirname, "img"); // The images tested will be copied here
const ppmTempFolder = path.join(__dirname, "tmp", "ppm");
const traverse = directory => {
    fs.readdirSync(directory).forEach(file => {
        const absolute = path.join(directory, file);
        if (fs.statSync(absolute).isDirectory()) return traverse(absolute);
        else return files.push(absolute);
    });
    return files;
}

// Clean the list of duplicates, non-images and empty files
const cleanList = files => {

    const validFileExtensions = [".jpg", ".jpeg", ".png", ".gif", ".bmp",
        ".tiff", ".tif", ".webp", ".svg", ".psd", ".ai", ".eps", ".svg",
        ".ppm", ".pgm", ".pbm", ".pnm", ".pam", ".pfm", ".pcx", ".xwd"];

    const deduper = (acc, curr) => {
        const fileSize = fs.statSync(curr).size;
        const sha256 = sha256File(curr);
        if (fileSize === 0) return acc;
        const entry = {
            fullname: curr,
            filename: path.basename(curr),
            originalSize: fileSize,
            originalsha256: sha256
        };
        const existing = acc.find(e => e.originalSize === fileSize && e.originalsha256 === sha256);
        if (existing) return acc;
        acc.push(entry);
        return acc;
    }

    const validFiles = files.filter(file =>
        validFileExtensions.includes(path.extname(file).toLowerCase()))
        .reduce(deduper, []);

    return validFiles;
}

// Copy the images to our img folder and delete the fullname property
const toTestbed = files => {
    // Copy the images to the img folder. Try to make a hardlink first, if that fails, copy the file.
    for (const image of files) {
        const newFile = path.join(imgFolder, image.filename);
        try { fs.linkSync(image.fullname, newFile); }
        catch (e) { fs.copyFileSync(image.fullname, newFile); }
        // Delete the fullname property; we only needed to copy the file
        delete image.fullname;
    }
    return files;
}


const normalizeToPPM = files => {

    const convert = file => {
        const ppmFile = path.join(ppmTempFolder, path.basename(file) + ".ppm");
        // Convert the image to a PPM file
        gm(file).write(ppmFile, (err) => {
            /* if (err) console.log(`Error: ${err.message}`);
            else console.log(`${file} converted to PPM.`); */
        });
    }

    const progressBarOptions = {
        total: files.length,
        show: {
            overwrite: true,
            bar: {
                length: 50,
                completed: '—',
                incompleted: '|',
            },
        },
        label: '         Converting to PPM ',
    }
    const bar = progressBar(progressBarOptions)

    files.forEach(file => {
        bar.tick("")
        const currentFile = path.join(imgFolder, file.filename);
        if (path.extname(file.filename).toLowerCase() === ".ppm") {
            // copy to the ppm folder
            const newFile = path.join(ppmTempFolder, file.filename.ppm);
            fs.copyFileSync(currentFile, newFile);
        }
        else convert(currentFile);
    });
    return files;
}

const getPPMStatistics = files => {
    const output = files.map(file => {
        const ppmFile = path.join(ppmTempFolder, file.filename + ".ppm");
        const stats = fs.statSync(ppmFile);
        return {
            ...file,
            ppmFile,
            ppmSize: stats.size,
            ppmsha256: sha256File(ppmFile)
        }
    });
    return output;
}

const getAllFiles = directory => getPPMStatistics(
    normalizeToPPM(
        toTestbed(
            cleanList(
                traverse(directory)
            )
        )
    )
);


module.exports = {
    getAllFiles
}
