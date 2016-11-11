# png-split-stream

Split a concatenated stream of PNG images into individual PNG frames

[![build status](https://secure.travis-ci.org/eugeneware/png-split-stream.png)](http://travis-ci.org/eugeneware/png-split-stream)

## Installation

This module is installed via npm:

``` bash
$ npm install png-split-stream
```

## Example Usage

### Reading a concatenated PNG file

``` js
var pngSplitStream = require('png-split-stream');

// all.png is a concatenation of multiple PNGs
// eg. `cat a.png b.png > all.png`
fs.createReadStream(__dirname + '/fixtures/all.png')
  .pipe(pngSplitStream())
  .on('data', function(data) {
    // each 'data' event contains one of the whole images as a single chunk
    console.log(data.slice(1, 4));
    // 'PNG'
  });
```

### Splitting an ffmpeg `image2pipe` PNG stream

``` js
var ffmpegBin = require('ffmpeg-static');
var spawn = require('child_process').spawn;
var ffmpeg = spawn(ffmpegBin.path, [
  '-i', 'myfile.mp4',
  '-f', 'image2pipe',
  '-vcodec', 'png',
  '-'
]);
ffmpeg.stdout
  .pipe(pngSplitStream())
  .on('data', function (data) {
    // each 'data' event contains one of the frames from the video as a single chunk
    console.log(data.slice(1, 4));
    // 'PNG'
  });
```

### Check if a file is a PNG file

``` js
var file = fs.readFileSync(__dirname + '/fixtures/trees.png');
console.log(pngSplitStream.probe(file));
// true

console.log(!pngSplitStream.probe(new Buffer(100)));
// false
```
