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
const { getAllFiles } = require("./utils.js") // Traverse the folder and returns all the files recursively
const fs = require("fs")
const { execSync } = require("child_process")
const path = require("path")
const progressBar = require('progress-barjs')
const sha256File = require('sha256-file'); // https://www.npmjs.com/package/sha256-file
const gm = require("gm") // GraphicsMagick


// Checks
const isWindows = process.platform === "win32"
const gmBin = isWindows ? "gm.exe" : "gm"
const haveGm = execSync(`${gmBin} version`, (err) => {
    if (err) {
        console.log(`Error: ${gmBin} is not in my path.`)
        return false
    }
    return true
})
const haveWine = isWindows ? false : execSync(`wine --version`, (err) => {
    if (err) {
        console.log(`Error: wine is not in my path.`)
        return false
    }
    return true
})


// Lea binaries
const lea0_4_comp = path.join(__dirname, "bin", "v0.4", "clea.exe")
const lea0_5_comp = path.join(__dirname, "bin", "v0.5b", "clea.exe")
const lea0_4_decomp = path.join(__dirname, "bin", "v0.4", "dlea.exe")
const lea0_5_decomp = path.join(__dirname, "bin", "v0.5b", "dlea.exe")

const dir = process.argv[2] || "./" // The folder to scan
const imgFolder = path.join(__dirname, "img") // The images tested will be copied here
const tempFolder = path.join(__dirname, "tmp") // The folder to store the temporary files (PPM and compressed files for both versions)
const reportFile = path.join(__dirname, "results.json")


// Probe the system and find out if I have my dependencies
if (!haveGm) {
    console.log("Error: I need GraphicsMagick to run. You can find it here: https://www.graphicsmagick.org/")
    process.exit(2)
}
if (!isWindows && !haveWine) {
    console.log("Error: I need WINE to run on *nix. You can find it here: https://www.winehq.org/")
    process.exit(2)
}


const processEverything = async () => {

    const report = []
    const allFiles = getAllFiles(dir)

    // console.log(`Found ${allFiles.length} images.`);
    // console.table(allFiles[0]);

    // Función auxiliar para ejecutar de manera sincrónica un comando externo
    // Luego se ejecutará el comando 3 veces para cada archivo
    // Para cada una se controla el tiempo de ejecución y se guarda el menor valor
    const runSync = (comand) => {
        try {
            const start = Date.now()
            const result = execSync(comand, { encoding: "utf8" })
            const end = Date.now()
            const time = end - start
            return {
                time,
                result
            }
        }
        catch (err) {
            console.warn(`Something went wrong while running command ${comand}`)
            return {
                time: -1,
                result: err
            }
        }
    }


    // Comprimimos con Lea 0.4
    const progressBarOptionsC04 = {
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
    const barC04 = progressBar(progressBarOptionsC04)
    allFiles.forEach(async file => {
        barC04.tick('')
        const input = `"${file.ppmFile}"`
        const outputV4 = path.join(__dirname, "tmp", "lea4", `"${file.filename}.ppm.lea4"`)

        // Ejecutamos el comando para comprimir 3 veces
        const times = []
        for (let i = 0; i < 3; i++) {
            const { time, result } = runSync(
                `${!isWindows ? "WINEDEBUG=-all wine" : ""} ${lea0_4_comp} ${input} ${outputV4} ${!isWindows ? "2>/dev/null" : ""}`
            )
            times.push(time)
        }

        // Calculamos el tiempo mínimo y lo guardamos en el reporte
        const minTime = Math.min(...times)
        const ppmSize = file.ppmSize
        const originalSize = file.originalSize
        // Get the size of uotputV4 using the command `du -b ${outputV4} | cut -f1` if we are on Linux, or `wc -c ${outputV4}` if we are on Windows
        const compressedSize = isWindows ?
            execSync(`wc -c ${outputV4}`, { encoding: "utf8" }).split(" ")[0] :
            // We need to trim the last two characters from the following output and convert it to number
            parseInt(execSync(`du -b ${outputV4} | cut -f1`, { encoding: "utf8" }).slice(0, -1))

        report.push({
            ...file,
            "cTime0.4": minTime,
            "cSpeed0.4": ppmSize / (minTime / 1000), // Speed in bytes per second
            "cSize0.4": compressedSize,
            "cRatio0.4": compressedSize / originalSize * 100,
            "cRatioPPM0.4": compressedSize / ppmSize * 100,
        })
    })

    // Comprimimos con Lea 0.5
    const progressBarOptionsC05 = {
        total: allFiles.length,
        label: '  Compressing with Lea 0.5 ',
        show: {
            overwrite: true,
            bar: {
                length: 50,
                completed: '—',
                incompleted: '|',
            },
        },
    }
    const barC05 = progressBar(progressBarOptionsC05)
    allFiles.forEach(async file => {
        barC05.tick('')
        const input = `"${file.ppmFile}"`
        const outputV5 = path.join(__dirname, "tmp", "lea5", `"${file.filename}.ppm.lea5"`)

        // Ejecutamos el comando para comprimir 3 veces
        const times = []
        for (let i = 0; i < 3; i++) {
            const { time, result } = runSync(
                `${!isWindows ? "WINEDEBUG=-all wine" : ""} ${lea0_5_comp} ${input} ${outputV5} ${!isWindows ? "2>/dev/null" : ""}`
            )
            times.push(time)
        }

        // Calculamos el tiempo mínimo y lo guardamos en el reporte
        const minTime = Math.min(...times)
        const ppmSize = file.ppmSize
        const originalSize = file.originalSize
        // Get the size of uotputV5 using the command `du -b ${outputV5} | cut -f1` if we are on Linux, or `wc -c ${outputV5}` if we are on Windows
        const compressedSize = isWindows ?
            execSync(`wc -c ${outputV5}`, { encoding: "utf8" }).split(" ")[0] :
            // We need to trim the last two characters from the following output and convert it to number
            parseInt(execSync(`du -b ${outputV5} | cut -f1`, { encoding: "utf8" }).slice(0, -1))

        // We need to find on the report the file with the same name as the one we are processing so we can add the new data for V5
        const index = report.findIndex(reportFile => file.originalsha256 === reportFile.originalsha256)
        const cRatio = compressedSize / originalSize * 100
        report[index] = {
            ...report[index],
            "cTime0.5": minTime,
            "cSpeed0.5": ppmSize / (minTime / 1000), // Speed in bytes per second
            "cSize0.5": compressedSize,
            "cRatio0.5": cRatio,
            "cRatioPPM0.5": compressedSize / ppmSize * 100,
            "cTimeDiff": minTime - report[index]["cTime0.4"], // positive if Lea 0.4 is faster
            "cRatioDiff": cRatio - report[index]["cRatio0.4"], // positive if Lea 0.4 is better
        }
    })

    // Restauramos los archivos originales con Lea 0.4
    const progressBarOptionsR04 = {
        total: allFiles.length,
        label: 'Decompressing with Lea 0.4 ',
        show: {
            overwrite: true,
            bar: {
                length: 50,
                completed: '—',
                incompleted: '|',
            },
        },
    }
    const barR04 = progressBar(progressBarOptionsR04)

    allFiles.forEach(async file => {
        barR04.tick('')
        const input = path.join(__dirname, "tmp", "lea4", `"${file.filename}.ppm.lea4"`)
        const output = path.join(__dirname, "tmp", "restored4", `"${file.filename}.ppm.restored"`)

        // Ejecutamos el comando para descomprimir 3 veces
        const times = []
        for (let i = 0; i < 3; i++) {
            const { time, result } = runSync(
                `${!isWindows ? "WINEDEBUG=-all wine" : ""} ${lea0_4_decomp} ${input} ${output} ${!isWindows ? "2>/dev/null" : ""}`
            )
            times.push(time)
        }

        // Calculamos el tiempo mínimo y lo guardamos en el reporte
        const minTime = Math.min(...times)
        // Get the size of uotput using the command `du -b ${output} | cut -f1` if we are on Linux, or `wc -c ${output}` if we are on Windows
        const decompressedSize = isWindows ?
            execSync(`wc -c ${output}`, { encoding: "utf8" }).split(" ")[0] :
            // We need to trim the last two characters from the following output and convert it to number
            parseInt(execSync(`du -b ${output} | cut -f1`, { encoding: "utf8" }).slice(0, -1))

        // We need to find on the report the file with the same name as the one we are processing so we can add the new data for V4
        const index = report.findIndex(reportFile => file.originalsha256 === reportFile.originalsha256)
        report[index] = {
            ...report[index],
            "dTime0.4": minTime,
            "dSpeed0.4": decompressedSize / (minTime / 1000), // Speed in bytes per second
            // Compression time plus decompression time
            "roundTrip0.4": report[index]["cTime0.4"] + minTime,
            // "isIdentical0.4": report[index].ppmsha256 === sha256File(output) ? "✓" : "✗",
        }
    })

    // Restauramos los archivos originales con Lea 0.5
    const progressBarOptionsR05 = {
        total: allFiles.length,
        label: 'Decompressing with Lea 0.5 ',
        show: {
            overwrite: true,
            bar: {
                length: 50,
                completed: '—',
                incompleted: '|',
            },
        },
    }
    const barR05 = progressBar(progressBarOptionsR05)

    allFiles.forEach(async file => {
        barR05.tick('')
        const input = path.join(__dirname, "tmp", "lea5", `"${file.filename}.ppm.lea5"`)
        const output = path.join(__dirname, "tmp", "restored5", `"${file.filename}.ppm.restored"`)

        // Ejecutamos el comando para descomprimir 3 veces
        const times = []
        for (let i = 0; i < 3; i++) {
            const { time, result } = runSync(
                `${!isWindows ? "WINEDEBUG=-all wine" : ""} ${lea0_5_decomp} ${input} ${output} ${!isWindows ? "2>/dev/null" : ""}`
            )
            times.push(time)
        }

        // Calculamos el tiempo mínimo y lo guardamos en el reporte
        const minTime = Math.min(...times)
        // Get the size of uotput using the command `du -b ${output} | cut -f1` if we are on Linux, or `wc -c ${output}` if we are on Windows
        const decompressedSize = isWindows ?
            execSync(`wc -c ${output}`, { encoding: "utf8" }).split(" ")[0] :
            // We need to trim the last two characters from the following output and convert it to number
            parseInt(execSync(`du -b ${output} | cut -f1`, { encoding: "utf8" }).slice(0, -1))

        // We need to find on the report the file with the same name as the one we are processing so we can add the new data for V5
        const index = report.findIndex(reportFile => file.originalsha256 === reportFile.originalsha256)
        const roundTrip = report[index]["cTime0.5"] + minTime
        report[index] = {
            ...report[index],
            "dTime0.5": minTime,
            "dSpeed0.5": decompressedSize / (minTime / 1000), // Speed in bytes per second
            // "isIdentical0.5": file.ppmsha256 === sha256File(output) ? "✓" : "✗",
            "dTimeDiff": minTime - report[index]["dTime0.4"], // positive if Lea 0.4 is faster
            "roundTrip0.5": roundTrip,
            "roundTripDiff": roundTrip - report[index]["roundTrip0.4"], // positive if Lea 0.4 is faster
        }
        delete report[index]["ppmFile"]
    })

    // Save the report to a json file
    fs.writeFileSync(path.join(__dirname, "report.jsonc"), JSON.stringify(report, null, 2))

    // report.forEach(file => console.table(file))
    // console.table(report[0])

}
processEverything()
