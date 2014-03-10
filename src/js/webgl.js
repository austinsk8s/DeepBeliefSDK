// Copyright 2014 Jetpac Inc
// All rights reserved.
// Pete Warden <pete@jetpac.com>
// Requires underscore, glMatrix
//
// To make initialization and calling easier, this library assumes some
// conventions in the way programs are laid out:
//
// - Transformation matrices are in uniforms called projection and modelView
// - There's a single vertex buffer attrib called vertexPosition

// The public API is:
//  new WebGL(pointWidth, pointHeight[, pixelScale])
//  createShaderProgram(name)
//  setUniformFloats(shaderName, uniformFloats)
//  createVertexBuffer(name, vertexValues, positionsPerVertex, texCoordsPerVertex) {
//  drawVertexBuffer(options)
//  createTextureFromUrl(name, url)
//  createTextureFromImage(name, image)
//  isTextureReady(textureName)
//  areAllTexturesReady()
//  setOneToOneProjection()
//  clearScreen()
//  enable(name)
//  disable(name)
//  blendFunc(arg0, arg1)

function WebGL(options) {

  var pointWidth = options.width;
  var pointHeight = options.height;

  var pixelScale;
  if (typeof options.pixelScale === 'undefined') {
    var isRetina = ((typeof window.devicePixelRatio !== 'undefined') && (window.devicePixelRatio >= 2));
    pixelScale = isRetina ? 2.0 : 1.0;
  } else {
    pixelScale = options.pixelScale;
  }

  var canvas;
  if (typeof options.canvas !== 'undefined') {
    canvas = options.canvas;
  } else {
    var canvas = document.createElement('canvas');
  }

  var pixelWidth = (pointWidth * pixelScale);
  var pixelHeight = (pointHeight * pixelScale);

  canvas.width = pixelWidth;
  canvas.height = pixelHeight;

  canvas.style.width = pointWidth;
  canvas.style.height = pointHeight;

  var context;
  try {
    var contextOptions = {};
    if (typeof options.antialias !== 'undefined') {
      contextOptions.antialias = true;
    }
    context = canvas.getContext('experimental-webgl', contextOptions);
    if (typeof WebGLDebugUtils !== 'undefined') {
      context = WebGLDebugUtils.makeDebugContext(context);
    }
    context.viewportWidth = pixelWidth;
    context.viewportHeight = pixelHeight;
  } catch (e) {
    this.error = 'Exception in WebGL.createCanvas()' + e.message;
  }
  if (!context) {
    if (!this.error) {
      this.error = 'Unknown error initializing WebGL';
    }
  }

  function throwOnGLError(err, funcName, args) {
    throw WebGLDebugUtils.glEnumToString(err) + " was caused by call to: " + funcName;
  };
 
  context = WebGLDebugUtils.makeDebugContext(context, throwOnGLError);

  this.canvas = canvas;
  this.pixelScale = pixelScale;
  this.pointWidth = pointWidth;
  this.pointHeight = pointHeight;
  this.programs = {};
  this.vertexBuffers = {};
  this.textures = {};
  this.gl = context;
  this.nameIndex = 0;

  // Used to be '_.bindAll(this)', see
  // https://github.com/jashkenas/underscore/commit/bf657be243a075b5e72acc8a83e6f12a564d8f55
  _.bindAll.apply(_, [this].concat(_.functions(this)))
};

WebGL.prototype = {
  createShaderProgram: function(vertexShaderText, fragmentShaderText) {
    var gl = this.gl;

    var vertexShader = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vertexShader, vertexShaderText);
    gl.compileShader(vertexShader);

    if (!gl.getShaderParameter(vertexShader, gl.COMPILE_STATUS)) {
      console.log('Vertex shader compilation failed - ' + gl.getShaderInfoLog(vertexShader));
      return null;
    }

    var fragmentShader = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fragmentShader, fragmentShaderText);
    gl.compileShader(fragmentShader);

    if (!gl.getShaderParameter(fragmentShader, gl.COMPILE_STATUS)) {
      console.log('Fragment shader compilation failed - ' + gl.getShaderInfoLog(fragmentShader));
      return null;
    }

    var name = this.uniqueName('shader');

    var shaderProgram = gl.createProgram();
    gl.attachShader(shaderProgram, vertexShader);
    gl.attachShader(shaderProgram, fragmentShader);
    gl.linkProgram(shaderProgram);

    if (!gl.getProgramParameter(shaderProgram, gl.LINK_STATUS)) {
      console.log('Could not initialise shaders for ' + name);
    }

    this.programs[name] = shaderProgram;
    shaderProgram.attribLocations = {};
    shaderProgram.uniformLocations = {};

//    gl.useProgram(shaderProgram);

    return name;
  },
  
  setUniformFloats: function(shaderName, uniformFloats) {
    var gl = this.gl;
    if (typeof uniformFloats === 'undefined') {
      return;
    }
    _.each(uniformFloats, _.bind(function(values, uniformName) {
      this.setUniformFloat(shaderName, uniformName, values);
    }, this));
  },

  createVertexBuffer: function(vertexValues, positionsPerVertex, texCoordsPerVertex) {
    var name = this.uniqueName('vertex buffer');
    var gl = this.gl;
    if (typeof this.vertexBuffers[name] !== 'undefined') {
      var buffer = this.vertexBuffers[name];
      gl.deleteBuffer(buffer);
    }
    if (typeof texCoordsPerVertex === 'undefined') {
      texCoordsPerVertex = 0;
    }
    var valuesPerVertex = (positionsPerVertex + texCoordsPerVertex);
    var buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertexValues), gl.STATIC_DRAW);
    buffer.valuesPerVertex = valuesPerVertex;
    buffer.positionsPerVertex = positionsPerVertex;
    buffer.texCoordsPerVertex = texCoordsPerVertex;
    buffer.vertexCount = Math.floor(vertexValues.length / valuesPerVertex);
    this.vertexBuffers[name] = buffer;
    return name;
  },

  drawVertexBuffer: function(options) {
    var gl = this.gl;
    var shaderName = options.shader;
    var vertexBufferName = options.vertexBuffer;
    var inputTextures = options.inputTextures || {};
    var uniformFloats = options.uniformFloats || {};
    var bufferParts = options.bufferParts;
    var mode = options.mode;
    var lineWidth = options.lineWidth;

    this.useShaderProgram(shaderName);
    this.setUniformFloats(shaderName, uniformFloats);
    var buffer = this.vertexBuffers[vertexBufferName];
    if (isGLError(buffer)) {
      console.log('Couldn\'t find vertex buffer "' + vertexBufferName + '"');
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);

    var textureUnitIndex = 0;
    _.each(inputTextures, _.bind(function(textureId, samplerName) {
      var texture = this.textures[textureId];
      gl.activeTexture(gl.TEXTURE0 + textureUnitIndex);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameterf(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameterf(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      var samplerLocation = this.getUniformLocation(shaderName, samplerName);
      gl.uniform1i(samplerLocation, textureUnitIndex);
      textureUnitIndex += 1;
    }, this));

    var stride = (buffer.valuesPerVertex * 4);
    var vertexPositionLocation = this.getAttribLocation(shaderName, 'vertexPosition');
    var positionsPerVertex = buffer.positionsPerVertex;
    gl.vertexAttribPointer(vertexPositionLocation,
      positionsPerVertex,
      gl.FLOAT,
      false,
      stride,
      0);
    var texCoordsPerVertex = buffer.texCoordsPerVertex;
    if (texCoordsPerVertex > 0) {
      var texCoordsLocation = this.getAttribLocation(shaderName, 'texCoords');
      var texCoordsOffset = (positionsPerVertex * 4);
      gl.vertexAttribPointer(texCoordsLocation,
        texCoordsPerVertex,
        gl.FLOAT,
        false,
        stride,
        texCoordsOffset);
    }

    if (typeof bufferParts === 'undefined') {
      bufferParts = [{ startOffset: 0, vertexCount: buffer.vertexCount}];
    }
    if (typeof mode === 'undefined') {
      mode = 'TRIANGLE_STRIP';
    }
    if (typeof lineWidth !== 'undefined') {
      gl.lineWidth(lineWidth);
    }
    _.each(bufferParts, _.bind(function(part) {
      this.setUniformFloats(shaderName, part.uniformFloats);
      gl.drawArrays(gl[mode], part.startOffset, part.vertexCount);
    }, this));

//    this.stopUsingShaderProgram(shaderName);
  },

  createTextureFromUrl: function(name, url) {
    var gl = this.gl;
    var texture = gl.createTexture();
    texture.image = document.createElement('img');
    texture.isReady = false;
    this.textures[name] = texture;
    var loadInfo = {
      gl: gl,
      texture: texture
    };
    texture.image.onload = _.bind(function() {
      var gl = this.gl;
      var texture = this.texture;
      var image = texture.image;
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.bindTexture(gl.TEXTURE_2D, null);
      texture.isReady = true;
    }, loadInfo);
    texture.image.src = url;
  },
  
  createTextureFromImage: function(name, image) {
    var gl = this.gl;
    var texture = gl.createTexture();
    this.textures[name] = texture;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.bindTexture(gl.TEXTURE_2D, null);
    texture.isReady = true;
  },

  createEmptyTexture: function(width, height, bitDepth) {
    var gl = this.gl;
    var name = this.uniqueName('texture ');
    var texture = gl.createTexture();
    this.textures[name] = texture;
    var dataType;
    if (_.isUndefined(bitDepth) || (bitDepth === 8)) {
      dataType = gl.UNSIGNED_BYTE;
    } else if (bitDepth === 32) {
      dataType = gl.FLOAT;
    } else {
      console.log('webgl.createEmptyTexture() - bad bit depth ' + bitDepth);
      return null;
    }
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, dataType, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, null);
    texture.isReady = true;
    texture.width = width;
    texture.height = height;
    texture.bitDepth = bitDepth;
    return name;
  },

  deleteTexture: function(name) {
    var texture = this.textures[name];
    gl.deleteTexture(texture);
    delete this.textures[name];
  },

  isTextureReady: function(name) {
    var texture = this.textures[name];
    return texture.isReady;
  },

  areAllTexturesReady: function() {
    var result = true;
    _.each(this.textures, _.bind(function(texture, name) {
      if (!this.isTextureReady(name)) {
        result = false;
      }
    }, this));
    return result;
  },

  setOneToOneProjection: function() {
    var gl = this.gl;
    var width = gl.viewportWidth;
    var height = gl.viewportHeight;
    var halfWidth = (width / 2);
    var halfHeight = (height / 2);
    gl.viewport(0, 0, width, height);

    var pointWidth = this.pointWidth;
    var pointHeight = this.pointHeight;
    var projection = mat4.ortho(0, pointWidth, pointHeight, 0, -1.0, 1.0);
    var modelView = mat4.identity(mat4.create());
  
    _.each(this.programs, _.bind(function(program, name) {
      var projectionLocation = this.getUniformLocation(name, 'projection');
      if (!isGLError(projectionLocation)) {
        this.useShaderProgram(name);
        gl.uniformMatrix4fv(projectionLocation, false, projection);
        this.stopUsingShaderProgram(name);
      }
      var modelViewLocation = this.getUniformLocation(name, 'modelView');
      if (!isGLError(modelViewLocation)) {
        this.useShaderProgram(name);
        gl.uniformMatrix4fv(modelViewLocation, false, modelView);
        this.stopUsingShaderProgram(name);
      }
    }, this));
  },
  
  clearScreen: function(red, green, blue, alpha) {
    if (typeof red === 'undefined') {
      red = 0.0;
    }
    if (typeof green === 'undefined') {
      green = 0.0;
    }
    if (typeof blue === 'undefined') {
      blue = 0.0;
    }
    if (typeof alpha === 'undefined') {
      alpha = 0.0;
    }
    var gl = this.gl;
    gl.clearColor(red, green, blue, alpha);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  },
  
  enable: function(name) {
    var gl = this.gl;
    gl.enable(gl[name]);
  },
  
  disable: function(name) {
    var gl = this.gl;
    gl.disable(gl[name]);
  },

  blendFunc: function(arg0, arg1) {
    var gl = this.gl;
    gl.blendFunc(gl[arg0], gl[arg1]);
  },

  // Internal functions

  useTexture: function(shaderName, textureName) {
    var gl = this.gl;
    gl.activeTexture(gl.TEXTURE0);
    if (!this.isTextureReady(textureName)) {
      console.log('Attempting to render before texture "' + name + '" is loaded');
      gl.bindTexture(gl.TEXTURE_2D, null);
    } else {
      var texture = this.textures[textureName];
      if (isGLError(texture)) {
        console.log('Couldn\'t find texture "' + textureName + '"');
      }
      gl.bindTexture(gl.TEXTURE_2D, texture);
    }
    var textureSamplerLocation = this.getUniformLocation(shaderName, 'textureSampler');
    gl.uniform1i(textureSamplerLocation, 0);
  },

  getShader: function(id, type) {
    var gl = this.gl;
    var shaderScript = document.getElementById(id);
    if (!shaderScript) {
      return null;
    }

    var str = "";
    var k = shaderScript.firstChild;
    while (k) {
      if (k.nodeType == 3) {
        str += k.textContent;
      }
      k = k.nextSibling;
    }

    var shader = gl.createShader(type);
    gl.shaderSource(shader, str);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      alert(gl.getShaderInfoLog(shader));
      return null;
    }

    return shader;
  },

  useShaderProgram: function(name) {
    var gl = this.gl;
    var program = this.programs[name];
    gl.useProgram(program);

    var vertexPositionLocation = this.getAttribLocation(name, 'vertexPosition');
    gl.enableVertexAttribArray(vertexPositionLocation);
    
    var texCoordsLocation = this.getAttribLocation(name, 'texCoords');
    if (!isGLError(texCoordsLocation)) {
      gl.enableVertexAttribArray(texCoordsLocation);
    }
  },

  stopUsingShaderProgram: function(name) {
    var gl = this.gl;
    var vertexPositionLocation = this.getAttribLocation(name, 'vertexPosition');
    gl.disableVertexAttribArray(vertexPositionLocation);    
    var texCoordsLocation = this.getAttribLocation(name, 'texCoords');
    if (!isGLError(texCoordsLocation)) {
      gl.disableVertexAttribArray(texCoordsLocation);
    }
  },

  getAttribLocation: function(shaderName, attribName) {
    var gl = this.gl;
    var program = this.programs[shaderName];
    var attribLocations = program.attribLocations;
    if (typeof attribLocations[attribName] === 'undefined') {
      gl.useProgram(program);
      var attribLocation = gl.getAttribLocation(program, attribName);
      if (isGLError(attribLocation)) {
        console.log('Attrib "' + attribName + '" not found for program "' + shaderName + '"');
      }
      attribLocations[attribName] = attribLocation;
    }
    var result = attribLocations[attribName];
    return result;
  },

  getUniformLocation: function(shaderName, uniformName) {
    var gl = this.gl;
    var program = this.programs[shaderName];
    var uniformLocations = program.uniformLocations;
    if (typeof uniformLocations[uniformName] === 'undefined') {
      gl.useProgram(program);
      var uniformLocation = gl.getUniformLocation(program, uniformName);
      if (isGLError(uniformLocation)) {
        console.log('Uniform "' + uniformName + '" not found for program "' + shaderName + '"');
      }
      uniformLocations[uniformName] = uniformLocation;
    }
    var result = uniformLocations[uniformName];
    return result;
  },

  setUniformFloat: function(shaderName, uniformName, values) {
    var gl = this.gl;
    if (typeof values.length === 'undefined') {
      values = [values];
    }
    var uniformLocation = this.getUniformLocation(shaderName, uniformName);
    if (isGLError(uniformLocation)) {
      console.log('Couldn\'t find uniform "' + uniformName + '" for program "' + shaderName + '"');
      return;
    }
    this.useShaderProgram(shaderName);
    var functionName = 'uniform' + values.length + 'fv';
    gl[functionName](uniformLocation, values);
  },

  uniqueName: function(prefix) {
    if (_.isUndefined(prefix)) {
      prefix = 'gl object';
    }
    var name = prefix + ' ' + this.nameIndex;
    this.nameIndex += 1;
    return name;
  },

  renderIntoTexture: function(textureName) {
    console.assert(!_.isUndefined(textureName));
    var gl = this.gl;
    var texture = this.textures[textureName];
    var framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) != gl.FRAMEBUFFER_COMPLETE) {
        throw new Error("gl.checkFramebufferStatus(gl.FRAMEBUFFER) != gl.FRAMEBUFFER_COMPLETE");
    }
  },

  readRenderedData: function() {
    var gl = this.gl;
    var pixels = new Uint8Array(gl.viewportWidth * gl.viewportHeight * 4);
    gl.readPixels(0, 0, gl.viewportWidth, gl.viewportHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    return pixels;
  }
};

function GPUCalculator(options) {
  options = options || {};
  this.webgl = new WebGL({
    width: 1,
    height: 1
  });
  this.shadersByText = {};
  this.vertexBuffersBySize = {};
  this.framebufferTexturesBySizeAndDepth = {};
}
GPUCalculator.prototype = {

  applyShader: function(options) {
    var webgl = this.webgl;
    var gl = webgl.gl;

    var fragmentShaderText = options.shaderText;
    var width = options.width;
    var height = options.height;
    var inputTextures = options.inputTextures || [];
    var bitDepth = options.bitDepth || 8;
    var uniformFloats = options.uniformFloats || {};

    if (_.isUndefined(this.shadersByText[fragmentShaderText])) {
      var passthruVertexShader = '' +
        '  precision mediump float;\n' +
        '  uniform mat4 modelView;\n' +
        '  uniform mat4 projection;\n' +
        '  attribute vec2 vertexPosition;\n' +
        '  attribute vec2 texCoords;\n' +
        '  varying vec2 outTexCoord;\n' +
        '  void main(void) {\n' +
        '    gl_Position = projection * modelView * vec4(vertexPosition, 0.0, 1.0);\n' +
        '    outTexCoord = texCoords;\n' +
        '  }\n';

      var shaderProgram = webgl.createShaderProgram(passthruVertexShader, fragmentShaderText);
      this.shadersByText[fragmentShaderText] = shaderProgram;
    }
    var shaderProgram = this.shadersByText[fragmentShaderText];

    var sizeKey = width + 'x' + height;
    if (_.isUndefined(this.vertexBuffersBySize[sizeKey])) {
      var viewBottom = 0;
      var viewTop = height;
      var viewLeft = 0;
      var viewRight = width;

      var vertices = [
        viewRight,  viewBottom,   viewRight,  viewBottom,
        viewLeft,   viewBottom,   viewLeft,   viewBottom,
        viewRight,  viewTop,      viewRight,  viewTop,
        viewLeft,   viewTop,      viewLeft,   viewTop
      ];
      var vertexBuffer = webgl.createVertexBuffer(vertices, 2, 2);
      this.vertexBuffersBySize[sizeKey] = vertexBuffer;
    }
    var vertexBuffer = this.vertexBuffersBySize[sizeKey];

    var framebufferTexture = webgl.createEmptyTexture(width, height, bitDepth);

    _.each(inputTextures, _.bind(function(textureId, samplerName) {
      var webgl = this.webgl;
      var texture = webgl.textures[textureId];
      var textureScaleX = (1.0 / texture.width);
      var textureScaleY = (1.0 / texture.height);
      var scaleName = samplerName + 'Scale';
      var offsetName = samplerName + 'Offset';
      uniformFloats[scaleName] = [textureScaleX, textureScaleY];
      uniformFloats[offsetName] = [0, 0];
    }, this));

    webgl.renderIntoTexture(framebufferTexture);
    webgl.setOneToOneProjection();
    webgl.disable('BLEND');

    webgl.drawVertexBuffer({
      shader: shaderProgram,
      vertexBuffer: vertexBuffer,
      uniformFloats: {},
      inputTextures: inputTextures
    });

    return framebufferTexture;
  },

  getResult: function(output) {
    var webgl = this.webgl;
    return webgl.readRenderedData();
  },

  deleteOutput: function(output) {
    var webgl = this.webgl;
    webgl.deleteTexture(output);
  }
};

function isGLError(value) {
  return ((value === -1) || (value === null) || (value === 'undefined'));
}

if ( !window.requestAnimationFrame ) {
  window.requestAnimationFrame = ( function() {
    return window.webkitRequestAnimationFrame ||
    window.mozRequestAnimationFrame ||
    window.oRequestAnimationFrame ||
    window.msRequestAnimationFrame ||
    function(callback, element) {
      window.setTimeout( callback, 1000 / 60 );
    };
  } )();
}

