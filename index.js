var util = require('util');
var Transform = require('stream').Transform;
var BufferList = require('bl');
var bufferEqual = require('buffer-equal');

// color types
var PNG_COLOR_TYPE_GRAY = 0;
var PNG_COLOR_TYPE_RGB = 2;
var PNG_COLOR_TYPE_INDEXED = 3;
var PNG_COLOR_TYPE_GRAYA = 4;
var PNG_COLOR_TYPE_RGBA = 6;

// decoder states
var PNG_SIGNATURE = 0;
var PNG_HEADER = 1;
var PNG_CHUNK = 2;
var PNG_CRC = 3;

var SIGNATURE = new Buffer([ 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a ]);

function PNGSplitStream(options) {
  if (!(this instanceof PNGSplitStream)) {
    return new PNGSplitStream(options);
  }

  Transform.call(this);

  this._outputIndexed = (options && options.indexed) || false;
  this._state = PNG_SIGNATURE;
  this._chunk = null;
  this._lastChunk = null;
  this._chunkSize = 0;
  this._consumed = 0;
  this._imageLength = 0;
  this._image = new BufferList();
  this._sawIDAT = false;
  this._buffer = new BufferList();
  this.meta = {};

  this.format = {
    animated: false,
    numFrames: 1,
    repeatCount: 0
  };
}

util.inherits(PNGSplitStream, Transform);

PNGSplitStream.prototype._transform = function(data, encoding, done) {
  var self = this;

  // process the state machine, possibly asynchronously
  function next() {
    while (self._buffer.length > 0) {
      switch (self._state) {
        case PNG_SIGNATURE:
          self._readSignature();
          break;

        case PNG_HEADER:
          self._readChunkHeader();
          self._lastChunk = self._chunk;
          break;

        case PNG_CHUNK:
          self._readChunk(next);
          return;

        case PNG_CRC:
          self._readCRC();
          if (self._lastChunk === 'IEND') {
            var image = self._image.slice(0, self._imageLength);
            self.push(image);
            self._image.consume(self._imageLength);
            self._imageLength = 0;
            self._state = PNG_SIGNATURE;
          }
          break;
      }
    }

    done();
  }

  this._buffer.append(data);
  this._image.append(data);
  next();
};

PNGSplitStream.prototype._readSignature = function() {
  if (this._buffer.length < 8)
    return 0;

  var sig = this._buffer.slice(0, 8);
  if (!bufferEqual(sig, SIGNATURE))
    return this.emit('error', new Error('Invalid PNG signature'));

  this._buffer.consume(8);
  this._imageLength += 8;
  this._state = PNG_HEADER;

  return 8;
};

PNGSplitStream.prototype._readChunkHeader = function() {
  var data = this._buffer;
  if (data.length < 8)
    return 0;

  this._chunkSize = data.readUInt32BE(0);
  this._chunk = data.toString('ascii', 4, 8);
  this._consumed = 0;
  this._state = PNG_CHUNK;

  data.consume(8);
  this._imageLength += 8;
  return 8;
};

PNGSplitStream.prototype._readChunk = function(done) {
  var consumed = 0;
  var handler = this['_read' + this._chunk];

  // make sure the callback is called at the end of this function
  var after = false;
  var called = false;
  function next() {
    if (after)
      done();
    else
      called = true;
  }

  // call the chunk handler
  if (handler) {
    consumed = handler.call(this, this._buffer, next);
  } else {
    consumed = Math.min(this._buffer.length, this._chunkSize - this._consumed);
    next();
  }

  // consume data read by the chunk handler
  this._buffer.consume(consumed);
  this._consumed += consumed;
  this._imageLength += consumed;

  if (this._consumed > this._chunkSize)
    return this.emit('error', new Error('Bad chunk size.'));

  // done with this chunk if we've reached the chunk size
  if (this._consumed === this._chunkSize) {
    this._chunk = null;
    this._chunkSize = 0;
    this._consumed = 0;
    this._state = PNG_CRC;
  }

  // call the callback if next was already called
  after = true;
  if (called)
    done();
};

PNGSplitStream.prototype._readCRC = function() {
  if (this._buffer.length < 4)
    return 0;

  this._buffer.consume(4);
  this._imageLength += 4;
  this._state = PNG_HEADER;

  return 4;
};

// Reads the image header chunk
PNGSplitStream.prototype._readIHDR = function(data, done) {
  if (data.length < 13) {
    done();
    return 0;
  }

  this.format.width = data.readUInt32BE(0);
  this.format.height = data.readUInt32BE(4);

  this.bits = data.get(8);
  this.colorType = data.get(9);
  this.compressionMethod = data.get(10);
  this.filterMethod = data.get(11);
  this.interlaceMethod = data.get(12);

  switch (this.colorType) {
    case PNG_COLOR_TYPE_INDEXED:
      this.colors = 1;
      this.format.colorSpace = this._outputIndexed ? 'indexed' : 'rgb';
      break;

    case PNG_COLOR_TYPE_GRAY:
      this.colors = 1;
      this.format.colorSpace = 'gray';
      break;

    case PNG_COLOR_TYPE_GRAYA:
      this.colors = 2;
      this.format.colorSpace = 'graya';
      break;

    case PNG_COLOR_TYPE_RGB:
      this.colors = 3;
      this.format.colorSpace = 'rgb';
      break;

    case PNG_COLOR_TYPE_RGBA:
      this.colors = 4;
      this.format.colorSpace = 'rgba';
      break;

    default:
      return this.emit('error', new Error('Invalid color type: ' + this.colorType));
  }

  this.pixelBits = this.bits * this.colors;
  this.pixelBytes = this.pixelBits >= 8 ? this.pixelBits >> 3 : (this.pixelBits + 7) >> 3;

  done();

  // we wait to emit the 'format' event, since the color space might change after a tRNS chunk
  return 13;
};

// Reads the image palette chunk
PNGSplitStream.prototype._readPLTE = function(data, done) {
  if (data.length < this._chunkSize) {
    done();
    return 0;
  }

  this._palette = data.slice(0, this._chunkSize);
  if (this._outputIndexed)
    this.format.palette = this._palette;

  done();
  return this._chunkSize;
};

// Reads the transparency chunk
PNGSplitStream.prototype._readtRNS = function(data, done) {
  if (data.length < this._chunkSize) {
    done();
    return 0;
  }

  if (this.colorType === PNG_COLOR_TYPE_INDEXED) {
    this._transparencyIndex = data.slice(0, this._chunkSize);
    if (this._outputIndexed) {
      this.format.alphaPalette = this._transparencyIndex;
    } else {
      this.format.colorSpace = 'rgba';
    }
  }

  done();
  return this._chunkSize;
};

// Reads metadata from the tEXt chunk
PNGSplitStream.prototype._readtEXt = function(data, done) {
  if (data.length < this._chunkSize) {
    done();
    return 0;
  }

  var buf = data.slice(0, this._chunkSize);
  var index = -1;
  for (var i = 0; i < buf.length; i++) {
    if (buf[i] === 0) {
      index = i;
      break;
    }
  }

  if (index >= 0) {
    var key = buf.toString('ascii', 0, index);
    var value = buf.toString('ascii', index + 1);
    this.meta[key] = value;
  }

  done();
  return this._chunkSize;
};

// Reads the animation header chunk
PNGSplitStream.prototype._readacTL = function(data, done) {
  if (data.length < this._chunkSize) {
    done();
    return 0;
  }

  this.format.animated = true;
  this.format.numFrames = data.readUInt32BE(0);
  this.format.repeatCount = data.readUInt32BE(4) || Infinity;

  done();
  return this._chunkSize;
};

// Reads the animation frame header chunk
PNGSplitStream.prototype._readfcTL = function(data, done) {
  if (data.length < this._chunkSize) {
    done();
    return 0;
  }

  var frame = {};

  frame.width = data.readUInt32BE(4);
  frame.height = data.readUInt32BE(8);
  frame.x = data.readUInt32BE(12);
  frame.y = data.readUInt32BE(16);

  var delayNum = data.readUInt16BE(20);
  var delayDen = data.readUInt16BE(22) || 100;
  frame.delay = delayNum / delayDen * 1000;

  frame.disposeOp = data.get(24);
  frame.blendOp = data.get(25);

  this.emit('frame', frame);

  done();

  return this._chunkSize;
};

// Reads the image data chunk
PNGSplitStream.prototype._readIDAT = function(data, done) {
  if (!this._sawIDAT) {
    this.emit('format', this.format);
    this.emit('meta', this.meta);
    this._sawIDAT = true;
  }

  var buf = data.slice(0, this._chunkSize - this._consumed);
  done();

  return buf.length;
};

// Reads frame data chunk
PNGSplitStream.prototype._readfdAT = function(data, done) {
  if (this._consumed === 0) {
    if (data.length < 4) {
      done();
      return 0;
    }

    // consume sequence number
    this._consumed = 4;
    data.consume(4);
    this._imageLength += 4;
  }

  return this._readIDAT(data, done);
};

// Ends the last frame
PNGSplitStream.prototype._flush = function(done) {
  done();
};

module.exports = PNGSplitStream;
