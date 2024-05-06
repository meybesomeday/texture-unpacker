import { join, extname, dirname, isAbsolute } from 'path';
import { readdirSync, lstatSync, existsSync, readFileSync, mkdirSync } from 'fs';
import * as plist from 'plist';
import sharp from 'sharp';

type ArrayElement<ArrayType extends readonly unknown[]> =
    ArrayType extends readonly (infer ElementType)[] ? ElementType : never;

type FramesArray = JSONArrayData['frames'];
type FramesArrayElement = ArrayElement<FramesArray>;
type Filename = FramesArrayElement['filename'];
type Meta = JSONArrayData['meta'];

/**
 * Also Cocos2d-x data format.
 */
interface Cocos2dData {
    frames: Record<Filename, {
        spriteOffset: string;
        spriteSourceSize: string;
        textureRect: string;
        textureRotated: boolean;
    }>;
    metadata: {
        format: 3;
        size: string;
    };
}

type Cocos2dFrameData = Cocos2dData['frames'][Filename];
type Cocos2dOldFrameData = Cocos2dOldData['frames'][Filename];

interface Cocos2dOldData {
    frames: Record<Filename, {
        frame: Cocos2dFrameData['textureRect'];
        offset: Cocos2dFrameData['spriteOffset'];
        rotated: Cocos2dFrameData['textureRotated'];
        sourceSize: Cocos2dFrameData['spriteSourceSize'];
    }>;
    metadata: {
        format: 2;
        size: Cocos2dData['metadata']['size'];
    };
}

interface PlistData {
    frames: Record<Filename, {
        frame: FramesArrayElement['frame'];
        offset: {
            x: number;
            y: number;
        };
        rotated: FramesArrayElement['rotated'];
        sourceSize: FramesArrayElement['sourceSize'];
    }>;
    metadata: Meta & {
        format: number;
    };
}

/**
 * Also Phaser 2 (JSONArray) data format.
 */
interface JSONArrayData {
    frames: {
        filename: string;
        frame: {
            x: number;
            y: number;
            w: number;
            h: number;
        };
        rotated: boolean;
        trimmed: boolean;
        spriteSourceSize: {
            x: number;
            y: number;
            w: number;
            h: number;
        };
        sourceSize: {
            w: number;
            h: number;
        };
    }[];
    meta: {
        size: {
            w: number;
            h: number;
        };
    };
}

/**
 * Also Phaser 2 (JSONHash) and PixiJS data formats.
 */
interface JSONHashData {
    frames: Record<
        Filename,
        Omit<FramesArrayElement, 'filename'>
    >;
    meta: Meta;
}

interface Phaser3Data {
    textures: Partial<Meta> & {
        image: string,
        frames: FramesArray;
    }[];
    meta: Partial<Meta>;
}

type SpritesData = Record<Filename, {
    rotated: boolean;
    extractRegion: sharp.Region;
    extendOptions: sharp.ExtendOptions;
}>;

type FileData = Record<string, {
    sprites: SpritesData;
}>;

const toNumbersArray = (str: string): number[] =>
{
    return str.replace(/{/g, '')
        .replace(/}/g, '')
        .split(',')
        .map(value => Number(value));
};

const parsePlistData = (rawData: string): PlistData =>
{
    const data = <any>plist.parse(rawData) as Cocos2dData | Cocos2dOldData;
    const metadata = data.metadata;
    const format = metadata.format;
    const size = toNumbersArray(metadata.size);

    const plistData = {
        frames: {},
        metadata: {
            format,
            size: {
                w: size[0],
                h: size[1]
            }
        }
    } as PlistData;

    if (format !== 2 && format !== 3)
    {
        console.warn(`Possible unexpected 'plist' data format [${format}].`);
    }

    for (const filename in data.frames)
    {
        const f = data.frames[filename];

        const frame = toNumbersArray(
            (f as Cocos2dFrameData).textureRect ||
            (f as Cocos2dOldFrameData).frame
        );
        const offset = toNumbersArray(
            (f as Cocos2dFrameData).spriteOffset ||
            (f as Cocos2dOldFrameData).offset
        );
        const rotated = !!(
            (f as Cocos2dFrameData).textureRotated ||
            (f as Cocos2dOldFrameData).rotated
        );
        const sourceSize = toNumbersArray(
            (f as Cocos2dFrameData).spriteSourceSize ||
            (f as Cocos2dOldFrameData).sourceSize
        );

        plistData.frames[filename] = {
            frame: {
                x: frame[0],
                y: frame[1],
                w: frame[2],
                h: frame[3]
            },
            offset: {
                x: offset[0],
                y: offset[1]
            },
            rotated,
            sourceSize: {
                w: sourceSize[0],
                h: sourceSize[1]
            }
        };

    }

    return plistData;
};

const parseJsonData = (data: any, imageName: string | null): JSONArrayData =>
{
    const frames = (data as JSONArrayData | JSONHashData).frames;

    if (frames)
    {
        if (Array.isArray(frames))
        {
            return data as JSONArrayData;
        }

        const hashData = data as JSONHashData;
        const jsonData = {
            frames: [],
            meta: hashData.meta
        } as JSONArrayData;

        for (const filename in frames)
        {
            jsonData.frames.push(Object.assign({
                filename
            } as FramesArrayElement, frames[filename]));
        }

        return jsonData;
    }
    else if ((data as Phaser3Data).textures)
    {
        const phaser3Data = data as Phaser3Data;
        const textureData = imageName !== null ? phaser3Data.textures.find(texture => texture.image === imageName) : phaser3Data.textures[0];

        const jsonData = {
            frames: textureData.frames,
            meta: Object.assign({}, phaser3Data.meta, textureData)
        } as JSONArrayData;
        delete ((<any>jsonData.meta) as
            ArrayElement<Phaser3Data['textures']>).frames;

        return jsonData;
    }

    console.warn('Possible unexpected \'json\' data format.');
    return data;
};

const getSpritesData = (rawData : string, ext: string, imageName: string | null): SpritesData =>
{

    if (ext === '.plist')
    {
        const data = parsePlistData(rawData);
        const spritesData: SpritesData = {};

        for (const filename in data.frames)
        {
            const f = data.frames[filename];
            const frame = f.frame;
            const offset = f.offset;
            const rotated = f.rotated;
            const ss = f.sourceSize;
            const w = frame.w;
            const h = frame.h;
            const x = !rotated ? frame.x : frame.y;
            const y = !rotated ? frame.y : data.metadata.size.w - h - frame.x;

            spritesData[filename] = {
                rotated,
                extractRegion: {
                    left: x,
                    top: y,
                    width: w,
                    height: h
                },
                extendOptions: {
                    left: (ss.w - w) / 2 + offset.x,
                    top: (ss.h - h) / 2 - offset.y,
                    right: (ss.w - w) / 2 - offset.x,
                    bottom: (ss.h - h) / 2 + offset.y,
                    background: { r: 0, g: 0, b: 0, alpha: 0 }
                }
            };
        }

        return spritesData;
    }
    else if (ext === '.json')
    {
        const data = parseJsonData(rawData, imageName);
        const spritesData: SpritesData = {};

        data.frames.forEach((f) =>
        {
            const frame = f.frame;
            const rotated = f.rotated;
            const trimmed = f.trimmed;
            const sss = f.spriteSourceSize;
            const ss = f.sourceSize;
            const w = frame.w;
            const h = frame.h;
            const x = !rotated ? frame.x : frame.y;
            const y = !rotated ? frame.y : data.meta.size.w - h - frame.x;

            spritesData[f.filename] = {
                rotated,
                extractRegion: {
                    left: x,
                    top: y,
                    width: w,
                    height: h
                },
                extendOptions: {
                    left: sss.x,
                    top: sss.y,
                    right: trimmed ? ss.w - sss.w - sss.x : 0,
                    bottom: trimmed ? ss.h - sss.h - sss.y : 0,
                    background: { r: 0, g: 0, b: 0, alpha: 0 }
                }
            };
        });

        return spritesData;
    }
    else
    {
        console.error(`Wrong data format on parsing: '${ext}'!`);
        process.exit(1);
    }
};

const getFileData = (filePath: string, ext: string): FileData =>
{
    const path = extname(filePath) == ".json" ? filePath : filePath + ext;
    const rawData = readFileSync(path, 'utf8');
    const data = JSON.parse(rawData);
    const fileData: FileData = {};
    if (ext == ".plist") {
        fileData[filePath] = {
            sprites: getSpritesData(data, ext, null)
        }
    }
    else if (ext == ".json") {
        if ((data as Phaser3Data).textures) {
            const phaser3Data = data as Phaser3Data;
            phaser3Data.textures.forEach((texture): any => {
                const imageName = texture.image;
                fileData[imageName] = {
                    sprites: getSpritesData(data, ext, imageName)
                }
            })
        }
        else {
            fileData[filePath] = {
                sprites: getSpritesData(data, ext, null)
            }
        }
    }
    return fileData;
}

const generateSprites = (filePath: string, ext: string): void =>
{
    const fileData = getFileData(filePath, ext);

    for (const fileName in fileData) {
        const spritesData = fileData[fileName].sprites;
        const path = dirname(filePath)
        const file = join(path, fileName).replace(textureFormatRegEx, '')
        const texture = sharp(`${file}.${textureFormat}`);
        const outPathBase = join(filePath.replace(ext, ''), '/')
        const promises: Promise<void>[] = [];

        for (const spriteName in spritesData)
        {
            let outPath = join(outPathBase, spriteName);
            if (!outPath.toLowerCase().endsWith('.png') && !outPath.toLowerCase().endsWith('webp'))
            {
                outPath += '.png';
            }

            const dir = dirname(outPath);
            if (!existsSync(dir))
            {
                mkdirSync(dir, { recursive: true });
            }

            const spriteData = spritesData[spriteName];

            promises.push(texture.clone()
                // Method order is important when rotating,
                // resizing, and/or extracting regions:
                // https://sharp.pixelplumbing.com/api-operation#rotate
                .rotate(spriteData.rotated ? -90 : 0)
                .extract(spriteData.extractRegion)
                .extend(spriteData.extendOptions)
                .toFile(outPath).then(() =>
                {
                    console.info(`${outPath} generated.`);
                },
                (reason) =>
                {
                    console.error(`'${spriteName}' error:`, reason);
                })
            );
        }

        Promise.all(promises).then(() =>
        {
            console.info(`Unpacking '${file}' complete.`);
        },
        (reason) =>
        {
            console.error(reason);
        });
    }
};

// Get the all files in the specified directory (path).
const getFiles = (path: string): string[] =>
{
    const results: string[] = [];
    const files = readdirSync(path);

    files.forEach((filename) =>
    {
        const fullPath = join(path, filename);

        if (existsSync(fullPath) && lstatSync(fullPath).isDirectory())
        {
            results.push(...getFiles(fullPath));
        }
        else if (fullPath.toLowerCase().endsWith(`.${textureFormat}`))
        {
            results.push(fullPath.replace(textureFormatRegEx, ''));
        }
    });

    return results;
};

// const getDataPath = (filePath: string, ext: string): string =>
// {
//     if (ext)
//     {
//         return filePath + ext;
//     }

//     for (let i = 0; i < dataFormats.length; i++)
//     {
//         const dataFormat = dataFormats[i];
//         const dataPath = `${filePath}.${dataFormat}`;

//         if (existsSync(dataPath))
//         {
//             console.info(`'${dataFormat}' data format found for '${filePath}'.`);
//             return dataPath;
//         }
//     }

//     return filePath;
// };

const unpack = (filePath: string, ext: string): void =>
{
    // const dataPath = getDataPath(filePath, ext);
    // const texturePath = `${filePath}.${textureFormat}`;

    // if (existsSync(dataPath) && existsSync(texturePath))
    // {
        generateSprites(filePath, extname(filePath));
    // }
    // else
    // {
    //     console.warn('Make sure you have both data and texture files'
    //         + ` in the same directory for:\n'${filePath}'`);
    // }
};

const getPathOrName = (argv: string[]): string =>
{
    const pathOrName = argv.length ? argv[0] : '';

    if (isAbsolute(pathOrName))
    {
        return pathOrName;
    }
    else
    {
        return join(__dirname, pathOrName);
    }
};

const getExtFromDataFormat = (argv: string[]): string =>
{
    if (argv.length < 2)
    {
        console.info('No data format passed, will check for all supported...');
        return '';
    }
    else
    {
        const ext = argv[1];

        switch (ext)
        {
            case 'json':
            case 'plist':
                console.info(`'${ext}' data format passed.`);
                return `.${ext}`;

            default:
                return '';
        }
    }
};

// Usage: npm run unpack [<path>] [<format>]
const argv = process.argv.slice(2);

const textureFormat = (argv[1] == "png") ? 'png' : 'webp';
const textureFormatRegEx = new RegExp(`.${textureFormat}$`, 'i');
// const dataFormats = ['json', 'plist'];

if (extname(argv[0]) == ".json") {

}


const pathOrName = getPathOrName(argv);
const ext = getExtFromDataFormat(argv);

// supports multiple file conversions
if (existsSync(pathOrName) && lstatSync(pathOrName).isDirectory())
{
    getFiles(pathOrName).forEach((filePath) =>
    {
        unpack(filePath, ext);
    });
}
else
{
    unpack(pathOrName.replace(textureFormatRegEx, ''), ext);
}
