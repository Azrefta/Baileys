"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.useMultiFileAuthState = void 0;
const async_lock_1 = __importDefault(require("async-lock"));
const promises_1 = require("fs/promises");
const path_1 = require("path");
const WAProto_1 = require("../../WAProto");
const auth_utils_1 = require("./auth-utils");
const generics_1 = require("./generics");
// We need to lock files due to the fact that we are using async functions to read and write files
// https://github.com/WhiskeySockets/Baileys/issues/794
// https://github.com/nodejs/node/issues/26338
// Default pending is 1000, set it to infinity
// https://github.com/rogierschouten/async-lock/issues/63
const fileLock = new async_lock_1.default({ maxPending: Infinity });
/**
 * stores the full authentication state in a single folder.
 * Far more efficient than singlefileauthstate
 *
 * Again, I wouldn't endorse this for any production level use other than perhaps a bot.
 * Would recommend writing an auth state for use with a proper SQL or No-SQL DB
 * */
export const useMultiFileAuthState = async(
  folder: string,
  name?: string
): Promise<{ state: AuthenticationState; saveCreds: () => Promise<void> }> => {
  // Sanitize and prepare base name (keep alphanumeric and underscore, max len 8)
  const sanitizeName = (input?: string) => {
    let base = input?.trim() || 'auth'
    base = base.replace(/\s+/g, '_')
    base = base.replace(/[^A-Za-z0-9_]/g, '')
    if (base.length > 8) base = base.slice(0, 8)
    return base || 'auth'
  }
  const baseName = sanitizeName(name)
  const credFileName = `${baseName}.json`

  const fixFileName = (file?: string) => file?.replace(/\//g, '__')?.replace(/:/g, '-')

  const writeData = async(data: any, file: string) => {
    const filePath = join(folder, fixFileName(file)!)
    const mutex = getFileLock(filePath)
    return mutex.acquire().then(async(release) => {
      try {
        await writeFile(filePath, JSON.stringify(data, BufferJSON.replacer))
      } finally {
        release()
      }
    })
  }

  const readData = async(file: string) => {
    try {
      const filePath = join(folder, fixFileName(file)!)
      const mutex = getFileLock(filePath)
      return await mutex.acquire().then(async(release) => {
        try {
          const data = await readFile(filePath, { encoding: 'utf-8' })
          return JSON.parse(data, BufferJSON.reviver)
        } finally {
          release()
        }
      })
    } catch {
      return null
    }
  }

  const removeData = async(file: string) => {
    try {
      const filePath = join(folder, fixFileName(file)!)
      const mutex = getFileLock(filePath)
      return mutex.acquire().then(async(release) => {
        try {
          await unlink(filePath)
        } catch {
        } finally {
          release()
        }
      })
    } catch {
    }
  }

  // Ensure folder exists
  const folderInfo = await stat(folder).catch(() => null)
  if (folderInfo) {
    if (!folderInfo.isDirectory()) {
      throw new Error(`Found non-directory at ${folder}, delete or specify a different location.`)
    }
  } else {
    await mkdir(folder, { recursive: true })
  }

  // Load or init credentials using custom credFileName
  const creds: AuthenticationCreds =
    (await readData(credFileName)) || initAuthCreds()

  return {
    state: {
      creds,
      keys: {
        get: async(type, ids) => {
          const data: { [_: string]: SignalDataTypeMap[typeof type] } = {}
          await Promise.all(
            ids.map(async id => {
              let value = await readData(`${type}-${id}.json`)
              if (type === 'app-state-sync-key' && value) {
                value = proto.Message.AppStateSyncKeyData.fromObject(value)
              }
              data[id] = value
            })
          )
          return data
        },
        set: async(data) => {
          const tasks: Promise<void>[] = []
          for (const category in data) {
            for (const id in data[category]) {
              const value = data[category][id]
              const file = `${category}-${id}.json`
              tasks.push(value ? writeData(value, file) : removeData(file))
            }
          }
          await Promise.all(tasks)
        }
      }
    },
    saveCreds: async() => {
      return writeData(creds, credFileName)
    }
  }
}
exports.useMultiFileAuthState = useMultiFileAuthState;
