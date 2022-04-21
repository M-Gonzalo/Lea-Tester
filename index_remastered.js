/* 
This program will test the Lea image compression program on all the images in the specified folder.
It will perform the following:
    1. Read the previous report if there is one (results.json)
    2. Find all the files in the folder received as a parameter
    3. For each file, find its size and sha256, and store them in an array of objects
    4. Based on the size and sha256, deduplicate entries on the file list
    5. For each file that is not already a PPM file, try to convert it to PPM using gm (GraphicsMagick)
    6. For each vailid PPM file, compress it using the Lea program, versions 0.4 and 0.5 (bin/v0.4/clea.exe and bin/v0.5/clea.exe), and calculate the time taken
    7. For each file, calculate the size of the compressed file and the ratio of the compressed file to the original file
    8. For each compressed file, restore the original file using the Lea program, versions 0.4 and 0.5 (bin/v0.4/dlea.exe and bin/v0.5/dlea.exe), and calculate the time taken
    9. For each restored file, check if it is identical to the original file
    10. Save everything in a report. It is an array of objects, each object containing the following:
        - file name
        - original file size
        - original file sha256
        - PPM converted image size
        - PPM converted image sha256
        - compressed file size for version 0.4
        - compressed file size for version 0.5
        - is the restored file identical to the original file?
        - difference between compressed file size for version 0.4 and version 0.5
        - ratio of compressed file size to original file size for version 0.4
        - ratio of compressed file size to original file size for version 0.5
        - ratio of compressed file size to PPM file size for version 0.4
        - ratio of compressed file size to PPM file size for version 0.5
        - difference between ratio to original file for version 0.4 and version 0.5
        - difference between ratio to PPM file for version 0.4 and version 0.5
        - time taken to compress the file for version 0.4
        - time taken to compress the file for version 0.5
        - compression speed for version 0.4 in kb/s
        - compression speed for version 0.5 in kb/s
        - difference between time taken to compress the file for version 0.4 and version 0.5
        - time taken to decompress the file for version 0.4
        - time taken to decompress the file for version 0.5
        - difference between time taken to decompress the file for version 0.4 and version 0.5
        - time taken to compress and decompress the file for version 0.4
        - time taken to compress and decompress the file for version 0.5
        - difference between time taken to compress and decompress the file for version 0.4 and version 0.5
        The object structure is as follows:
            {
                "filename": "filename.jpg",
                "originalSize": 12345,
                "originalsha256": "1234567890",
                "ppmSize": 123456,
                "ppmsha256": "1234567899",
                "cSize0.4": 123456,
                "cSize0.5": 123456,
                "isIdentical": ✓ or ✗,
                "cSizeDiff": 123456 or -123456,
                "cRatio0.4": 123456,
                "cRatio0.5": 123456,
                "cRatioPPM0.4": 123456,
                "cRatioPPM0.5": 123456,
                "cRatioDiff": 123456 or -123456,
                "cRatioPPMDiff": 123456 or -123456,
                "cTime0.4": 123456,
                "cTime0.5": 123456,
                "cSpeed0.4": 123456,
                "cSpeed0.5": 123456,
                "cTimeDiff": 123456 or -123456,
                "dTime0.4": 123456,
                "dTime0.5": 123456,
                "dTimeDiff": 123456 or -123456,
                "roundTripTime0.4": 123456,
                "roundTripTime0.5": 123456,
                "roundTripTimeDiff": 123456 or -123456
            }
    11. Save the report in a JSON file (results.json)
To run the test, you need to have the following programs installed:
    - gm (GraphicsMagick)
    - clea (Lea version 0.4 - included in ./bin/v0.4/)
    - dlea (Lea version 0.5 - included in ./bin/v0.5/)
    - wine (if you are using anything but Windows)
 */

// Import the required modules
const { getAllFiles } = require("./utils.js"); // Traverse the folder and returns all the files recursively
const fs = require("fs");
const { execSync } = require("child_process");
const path = require("path");
const progressBar = require('progress-barjs');
const gm = require("gm"); // GraphicsMagick


// Checks
const isWindows = process.platform === "win32";
const gmBin = isWindows ? "gm.exe" : "gm";
const haveGm = execSync(`${gmBin} version`, (err) => {
    if (err) {
        console.log(`Error: ${gmBin} is not in my path.`);
        return false;
    }
    return true;
});
const haveWine = isWindows ? false : execSync(`wine --version`, (err) => {
    if (err) {
        console.log(`Error: wine is not in my path.`);
        return false;
    }
    return true;
});


// Lea binaries
const lea0_4_comp = path.join(__dirname, "bin", "v0.4", "clea.exe");
const lea0_5_comp = path.join(__dirname, "bin", "v0.5b", "clea.exe");
const lea0_4_decomp = path.join(__dirname, "bin", "v0.4", "dlea.exe");
const lea0_5_decomp = path.join(__dirname, "bin", "v0.5b", "dlea.exe");

const dir = process.argv[2] || "./"; // The folder to scan
const imgFolder = path.join(__dirname, "img"); // The images tested will be copied here
const tempFolder = path.join(__dirname, "tmp"); // The folder to store the temporary files (PPM and compressed files for both versions)
const reportFile = path.join(__dirname, "results.json");


// Probe the system and find out if I have my dependencies
if (!haveGm) {
    console.log("Error: I need GraphicsMagick to run. You can find it here: https://www.graphicsmagick.org/");
    process.exit(2);
}
if (!isWindows && !haveWine) {
    console.log("Error: I need WINE to run on *nix. You can find it here: https://www.winehq.org/");
    process.exit(2);
}


const processEverything = async () => {

    const report = [];
    const allFiles = getAllFiles(dir);

    // console.log(`Found ${allFiles.length} images.`);
    // console.table(allFiles[0]);

    // Función auxiliar para ejecutar de manera sincrónica un comando externo
    // Luego se ejecutará el comando 3 veces para cada archivo
    // Para cada una se controla el tiempo de ejecución y se guarda el menor valor
    const runSync = (comand) => {
        try {
            const start = Date.now();
            const result = execSync(comand, { encoding: "utf8" });
            const end = Date.now();
            const time = end - start;
            return {
                time,
                result
            };
        }
        catch (err) {
            console.warn(`Something went wrong while running command ${comand}`);
            return {
                time: -1,
                result: err
            };
        }
    }


    // Comprimimos con Lea 0.4
    const progressBarOptions = {
        total: allFiles.length,
        label: '  Compressing with Lea 0.4 ',
        show: {
            overwrite: true,
            bar: {
                length: 50,
                completed: '—',
                incompleted: '|',
            },
        },
    }
    const bar = progressBar(progressBarOptions)
    allFiles.forEach((file, index) => {
        const input = `"${file.ppmFile}"`;
        const outputV4 = path.join(__dirname, "tmp", "lea4", `"${file.filename}.ppm.lea4"`);

        // Ejecutamos el comando para comprimir 3 veces
        const times = [];
        for (let i = 0; i < 3; i++) {
            const { time, result } = runSync(`${!isWindows ? "WINEDEBUG=-all wine" : ""} ${lea0_4_comp} ${input} ${outputV4} ${!isWindows ? "2>/dev/null" : ""}`);
            times.push(time);
        }

        // Calculamos el tiempo mínimo y lo guardamos en el reporte
        const minTime = Math.min(...times);
        const ppmSize = file.ppmSize;
        const compressedSize = ""
        fs.stat(outputV4, (err, stats) => {
            if (err) null
            else compressedSize = stats.size;
        });
        report.push({
            ...file,
            "cTime0.4": minTime,
            "cSpeed0.4": file.size / minTime,
            "cSize0.4": compressedSize,
            "cRatio0.4": compressedSize / file.size,
            "cRatioPPM0.4": compressedSize / ppmSize,
        });
        bar.tick('')
    });
    bar.reset();


    // Para cada fichero en allFiles, comprimimos y descomprimimos con cada versión de Lea
    allFiles.forEach((file, index) => {
        const outputV5 = path.join(__dirname, "tmp", "lea5", `${file.filename}.ppm.lea5`);
        const restored4 = path.join(__dirname, "tmp", "restored4", `${file.filename}.ppm`);
        const restored5 = path.join(__dirname, "tmp", "restored5", `${file.filename}.ppm`);
    });


    console.table(report[0]);

}
processEverything();
