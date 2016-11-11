var pngSplitStream = require('../index');
var assert = require('assert');
var fs = require('fs');
var bl = require('bl');

describe('PNGSplitStream', function() {
  it('splits a concatenated png image', function(done) {
    var images = [];
    fs.createReadStream(__dirname + '/fixtures/all.png')
      .pipe(pngSplitStream())
      .on('data', function(data) {
        images.push(data);
      })
      .on('end', function() {
        assert.equal(images.length, 6);
        var lengths = images.map(function (image) { return image.length });
        assert.deepEqual(lengths, [ 288313, 129722, 97918, 36533, 151800, 400304 ]);
        done();
      });
  });

  it('splits an RGB image', function(done) {
    fs.createReadStream(__dirname + '/fixtures/trees.png')
      .pipe(pngSplitStream())
      .pipe(bl(function(err, images) {
        if (err) return done(err);
        assert.equal(images.length, 400304);
        assert.equal(this._bufs.length, 1);
        done();
      }));
  });

  it('splits an RGBA image', function(done) {
    fs.createReadStream(__dirname + '/fixtures/djay.png')
      .pipe(pngSplitStream())
      .pipe(bl(function(err, image) {
        assert.equal(image.length, 129722);
        assert.equal(this._bufs.length, 1);
        done();
      }));
  });

  it('splits an indexed RGBA image', function(done) {
    fs.createReadStream(__dirname + '/fixtures/djay-indexed.png')
      .pipe(pngSplitStream({ indexed: true }))
      .pipe(bl(function(err, image) {
        assert.equal(image.length, 36533);
        assert.equal(this._bufs.length, 1);
        done();
      }));
  });

  it('splits a grayscale image', function(done) {
    fs.createReadStream(__dirname + '/fixtures/gray.png')
      .pipe(pngSplitStream())
      .pipe(bl(function(err, image) {
        assert.equal(image.length, 151800);
        assert.equal(this._bufs.length, 1);
        done();
      }));
  });

  it('splits a grayscale image with alpha', function(done) {
    fs.createReadStream(__dirname + '/fixtures/graya.png')
      .pipe(pngSplitStream())
      .pipe(bl(function(err, image) {
        assert.equal(image.length, 97918);
        assert.equal(this._bufs.length, 1);
        done();
      }));
  });

  it('splits an animated image', function(done) {
    fs.createReadStream(__dirname + '/fixtures/chompy.png')
      .pipe(pngSplitStream())
      .pipe(bl(function(err, image) {
        assert.equal(image.length, 288313);
        assert.equal(this._bufs.length, 1);
        done();
      }));
  });
});
