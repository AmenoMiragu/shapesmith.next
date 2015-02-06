// The adapter is the interface between vertices and lathe objects
define([
    'underscore',
    'backbone-events',
    'casgraph/sha1hasher',
    'geomnode',
    'geometrygraphsingleton',
    'latheapi/normalize',
    'latheapi/pool',
    'latheapi/bspdb',
  ], function(
    _,
    Events,
    SHA1Hasher,
    GeomNode,
    geometryGraph,
    Normalize,
    Lathe,
    BSPDB) {

    var infoHandler = function() {
      console.info.apply(console, arguments);
    };

    var errorHandler = function() {
      console.error.apply(console, arguments);
    };

    var bspdb = new BSPDB(infoHandler, errorHandler); 

    function createSphere(sha, normalized) {
      var sphere = CSG.sphere({ 
        center: [normalized.x, normalized.y, normalized.z],
        radius: normalized.r,
        slices: 36,
        stacks: 18,
      });

    }

    var getOrGenerate = function(sha, generator, callback) {
      // Read from the DB, or generate it if it doesn't exist
      bspdb.read(sha, function(err, jobResult) {
        if (err) {
          console.error('error reading from BSP DB', err);
        }
        if (false) {
          callback(undefined, jobResult);
        } else {
          var jobId = generator();
          Lathe.broker.on(jobId, function(jobResult) {

            bspdb.write({
              sha: sha,
              polygons: jobResult.polygons,
              serializedBSP: jobResult.serializedBSP,
            }, function(err) {
              if (err) {
                postMessage({error: 'error writing to BSP DB' + err});
              }
            });

            jobResult.sha = sha;
            jobResult.id = jobId;
            callback(undefined, jobResult);
          });
        }
      });
    };

    var generateBoolean = function(vertex, latheGenerator, callback) {

      var children = geometryGraph.childrenOf(vertex);
      var childResults = {};
      var allChildrenExist;

      // Ensure all children exist 
      var remaining = children.length;
      children.forEach(function(child) {
        generate(child, function(err, result) {
          if (err) {
            callback(err);
          } else {
            --remaining;
            childResults[child.id] = result;
            if (remaining === 0) {
              allChildrenExist();
            }
          }
        });
      });

      allChildrenExist = function() {
        var uniqueObj = GeomNode.strip(vertex);
        var childSHAs = children.map(function(child) {
          return childResults[child.id].sha;
        });
        uniqueObj.childSHAs = childSHAs;
        var sha = SHA1Hasher.hash(uniqueObj);

        var childBSPs = children.map(function(child) {
          return childResults[child.id].serializedBSP;
        });

        if (addCallbackAndShouldGenerate(sha, callback)) {
          getOrGenerate(sha, function() {
            var normalized = Normalize.normalizeVertex(vertex);
            return latheGenerator(sha, childBSPs, normalized.transforms, normalized.workplane);
          }, performCallback);
        }
      };
      
    };

    // Share the generate callbacks so only a single generate is performed
    // for multiple renders for example

    var generateCallbacks = {};

    var addCallbackAndShouldGenerate = function(sha, callback) {
      if (!generateCallbacks[sha]) {
        generateCallbacks[sha] = [];
      }
      generateCallbacks[sha].push(callback);
      return generateCallbacks[sha].length === 1;
    };

    var performCallback = function(err, result) {
      generateCallbacks[result.sha].forEach(function(callback) {
        callback(err, result);
      });
      generateCallbacks[result.sha] = undefined;
    };

    var generate = function(vertex, callback) {
      var normalized, sha;
      switch (vertex.type) {
      case 'sphere':
        normalized = Normalize.normalizeVertex(vertex);
        sha = SHA1Hasher.hash(normalized);
        if (addCallbackAndShouldGenerate(sha, callback)) {
          getOrGenerate(sha, function() {
            return Lathe.createSphere(sha, normalized, normalized.transforms, normalized.workplane);
          }, performCallback);
        }
        break;
      case 'cylinder':
        normalized = Normalize.normalizeVertex(vertex);
        sha = SHA1Hasher.hash(normalized);
        if (addCallbackAndShouldGenerate(sha, callback)) {
          getOrGenerate(sha, function() {
            return Lathe.createCylinder(sha, normalized, normalized.transforms, normalized.workplane);
          }, performCallback);
        }
        break;
      case 'cone':
        normalized = Normalize.normalizeVertex(vertex);
        sha = SHA1Hasher.hash(normalized);
        if (addCallbackAndShouldGenerate(sha, callback)) {
          getOrGenerate(sha, function() {
            return Lathe.createCone(sha, normalized, normalized.transforms, normalized.workplane);
          }, performCallback);
        }
        break;
      case 'cube':
        normalized = Normalize.normalizeVertex(vertex);
        sha = SHA1Hasher.hash(normalized);
        if (addCallbackAndShouldGenerate(sha, callback)) {
          getOrGenerate(sha, function() {
            return Lathe.createCube(sha, normalized, normalized.transforms, normalized.workplane);
          }, performCallback);
        }
        break;
      case 'union':
        generateBoolean(vertex, Lathe.createUnion, callback);
        break;
      case 'subtract':
        generateBoolean(vertex, Lathe.createSubtract, callback);
        break;
      case 'intersect':
        generateBoolean(vertex, Lathe.createIntersect, callback);
        break;
      default:
        throw new Error('unknown vertex id/type: ' + vertex.id + '/' + vertex.type);
      }
    };

    var Broker = function() {
      _.extend(this, Events);
    };
    var broker = new Broker();
    this.broker = broker;

    var uiDBInitialized = false, poolInitialized = false;
    bspdb.on('initialized', function() {
      uiDBInitialized = true;
      if (uiDBInitialized && poolInitialized) {
        broker.trigger('initialized');
      }
    });
    Lathe.broker.on('initialized', function() {
      poolInitialized = true;
      if (uiDBInitialized && poolInitialized) {
        broker.trigger('initialized');
      }
    });

    return {
      generate: generate,
      broker  :  broker,
    };

  });