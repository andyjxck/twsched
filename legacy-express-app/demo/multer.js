// Demo only: stand-in for multer. The page hands the backend a FormData; single(name) turns the
// chosen file into req.file with a Buffer, the way multer's memory storage does.
function multer(opts = {}) {
  const max = opts.limits?.fileSize ?? Infinity
  return {
    single: (name) => async (req, res, next) => {
      try {
        const f = req._form?.get?.(name)
        if (f && typeof f === 'object' && 'arrayBuffer' in f) {
          if (f.size > max) { const e = new Error('File too large'); e.code = 'LIMIT_FILE_SIZE'; e.name = 'MulterError'; return next(e) }
          const buffer = Buffer.from(new Uint8Array(await f.arrayBuffer()))
          req.file = { fieldname: name, originalname: f.name || 'file', mimetype: f.type || 'application/octet-stream', size: f.size, buffer }
        }
        next()
      } catch (e) { next(e) }
    },
  }
}
multer.memoryStorage = () => ({})
export default multer
