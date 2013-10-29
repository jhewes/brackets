/*
 * Copyright (c) 2013 Adobe Systems Incorporated. All rights reserved.
 *  
 * Permission is hereby granted, free of charge, to any person obtaining a
 * copy of this software and associated documentation files (the "Software"), 
 * to deal in the Software without restriction, including without limitation 
 * the rights to use, copy, modify, merge, publish, distribute, sublicense, 
 * and/or sell copies of the Software, and to permit persons to whom the 
 * Software is furnished to do so, subject to the following conditions:
 *  
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *  
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, 
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER 
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING 
 * FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER 
 * DEALINGS IN THE SOFTWARE.
 * 
 */


/*jslint vars: true, plusplus: true, devel: true, node: true, nomen: true, indent: 4, maxerr: 50 */

"use strict";

var Promise = require("bluebird"),
    fs = Promise.promisifyAll(require("fs"));

var _domainManager,
    _watcherMap = {};

function _addStats(obj, stats) {
    obj.isFile = !stats.isDirectory();
    obj.mtime = stats.mtime.getTime();
    obj.size = stats.size;
    return obj;
}

function readdirCmd(path, callback) {
    fs.readdirAsync(path)
        .then(function (names) {
            var statPromises = names.map(function (name) {
                return fs.statAsync([path, name].join(""));
            });
            
            return Promise.settle(statPromises)
                .then(function (inspectors) {
                    return inspectors.reduce(function (total, inspector, index) {
                        if (inspector.isFulfilled()) {
                            total.push(_addStats({name: names[index]}, inspector.value()));
                        }
                        return total;
                    }, []);
                });
        })
        .nodeify(callback);
}

function readFileCmd(path, encoding, callback) {
    var readPromise = fs.readFileAsync(path, {encoding: "binary"}),
        statPromise = fs.statAsync(path);
    
    Promise.join(readPromise, statPromise)
        .spread(function (data, stats) {
            var filteredData = data.toString(encoding);
            return _addStats({data: filteredData}, stats);
        })
        .nodeify(callback);
}

/**
 * Un-watch a file or directory.
 * @param {string} path File or directory to unwatch.
 */
function unwatchPath(path) {
    var watcher = _watcherMap[path];
    
    if (watcher) {
        try {
            watcher.close();
        } catch (err) {
            console.warn("Failed to unwatch file " + path + ": " + (err && err.message));
        } finally {
            delete _watcherMap[path];
        }
    }
}

/**
 * Watch a file or directory.
 * @param {string} path File or directory to watch.
 */
function watchPath(path) {
    if (_watcherMap.hasOwnProperty(path)) {
        return;
    }
    
    try {
        var watcher = fs.watch(path, {persistent: false}, function (event, filename) {
            // File/directory changes are emitted as "change" events on the fileSystem domain.
            _domainManager.emitEvent("fileSystem", "change", [path, event, filename]);
        });

        _watcherMap[path] = watcher;
        
        watcher.on("error", function (err) {
            console.error("Error watching file " + path + ": " + (err && err.message));
            unwatchPath(path);
        });
    } catch (err) {
        console.warn("Failed to watch file " + path + ": " + (err && err.message));
    }
}

/**
 * Un-watch all files and directories.
 */
function unwatchAll() {
    var path;
    
    for (path in _watcherMap) {
        if (_watcherMap.hasOwnProperty(path)) {
            unwatchPath(path);
        }
    }
}

/**
 * Initialize the "fileSystem" domain.
 */
function init(domainManager) {
    if (!domainManager.hasDomain("fileSystem")) {
        domainManager.registerDomain("fileSystem", {major: 0, minor: 1});
    }
    
    domainManager.registerCommand(
        "fileSystem",
        "readdir",
        readdirCmd,
        true,
        "Read the contents of a directory",
        [{
            name: "path",
            type: "string",
            description: "absolute filesystem path of the directory to read"
        }],
        [{
            name: "statObjs",
            type: "Array.<{path: string, isFile: boolean, mtime: number, size: number}>",
            description: "An array"
        }]
    );
    domainManager.registerCommand(
        "fileSystem",
        "readFile",
        readFileCmd,
        true,
        "Read the contents of a file",
        [{
            name: "path",
            type: "string",
            description: "absolute filesystem path of the file to read"
        }, {
            name: "encoding",
            type: "string",
            description: "encoding with which to read the file"
        }],
        [{
            name: "statObjs",
            type: "Array.<{path: string, isFile: boolean, mtime: number, size: number}>",
            description: "An array"
        }]
    );
    domainManager.registerCommand(
        "fileSystem",
        "watchPath",
        watchPath,
        false,
        "Start watching a file or directory",
        [{
            name: "path",
            type: "string",
            description: "absolute filesystem path of the file or directory to watch"
        }]
    );
    domainManager.registerCommand(
        "fileSystem",
        "unwatchPath",
        unwatchPath,
        false,
        "Stop watching a file or directory",
        [{
            name: "path",
            type: "string",
            description: "absolute filesystem path of the file or directory to unwatch"
        }]
    );
    domainManager.registerCommand(
        "fileSystem",
        "unwatchAll",
        unwatchAll,
        false,
        "Stop watching all files and directories"
    );
    domainManager.registerEvent(
        "fileSystem",
        "change",
        [
            {name: "path", type: "string"},
            {name: "event", type: "string"},
            {name: "filename", type: "string"}
        ]
    );
    
    _domainManager = domainManager;
}

exports.init = init;

