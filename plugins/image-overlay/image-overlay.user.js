// ==UserScript==
// @id             iitc-plugin-image-overlay@57Cell
// @name           IITC Plugin: 57Cell's Image Overlay
// @version        0.1.5.20261111
// @description    Plugin for overlaying and adjusting images on the map
// @author         57Cell (Michael Hartley), Qu4rd and Claude.AI
// @category       Layer
// @namespace      https://github.com/jonatkins/ingress-intel-total-conversion
// @updateURL      https://github.com/mike40033/iitc-57Cell/raw/master/plugins/image-overlay/image-overlay.meta.js
// @downloadURL    https://github.com/mike40033/iitc-57Cell/raw/master/plugins/image-overlay/image-overlay.user.js
// @include        https://intel.ingress.com/*
// @match          https://intel.ingress.com/*
// @grant          none
// ==/UserScript==

var pluginName = "57Cell's Image Overlay";
var version = "0.1.5";
var changeLog = [
    {
        version: '0.1.5.20261111',
        changes: [
            'Thanks to Ingress agent Qu4rd for contributing most of the fixes and the local image loading in this release',
            'Fixed @match/@include so the script loads on intel.ingress.com',
            'Added loading an image from a local file (stored as a data URL)',
            'Large local images are downscaled to fit in localStorage',
            'Local images keep transparency unless they are JPEGs',
            'Warn when an image is too large to save, instead of silently restoring an older image on reload',
            'Fixed fine zoom slider default value',
            'Fixed resetSliders targeting wrong element IDs',
            'Fixed Reset zoom button, which previously did nothing',
            'Removed duplicate controls container and unused showDialog',
            'Fixed clearing of lat/lng inputs when no image is present',
            'Applying a different image now places it fresh instead of reusing the old image\'s bounds',
            'Aspect ratio is recalculated from saved bounds on reload',
            'Remove Image now also clears the URL, file input and stored image data',
        ],
    },
    {
        version: '0.1.4.20240807',
        changes: [
            'Removed drag-to-move functionality',
            'Added dialog controls for moving image',
            'Made lat/lng editable',
            'Added View button to pan to image',
            'Added dynamic unit display (m/km)',
            'Implemented state persistence using localStorage',
        ],
    },
];

function wrapper(plugin_info) {
    if (typeof window.plugin !== 'function') window.plugin = function() {};
    plugin_info.buildName = '';
    plugin_info.dateTimeVersion = '2026-11-11-120000';
    plugin_info.pluginId = '57CellsImageOverlay';

    // PLUGIN START ////////////////////////////////////////////////////////

    window.plugin.imageOverlay = function() {};
    var self = window.plugin.imageOverlay;

    self.imageOverlay = null;
    self.imageUrl = '';
    self.isLocal = false;
    self.imageBounds = null;
    self.imageOpacity = 0.5;
    self.layerGroup = null;
    self.imageAspectRatio = 1;
    self.baseWidth = null; // width (degrees lng) when the image was first placed
    self.saveWarnedFor = null;
    self.imageZoom = 1;
    self.imageRotation = 0;
    self.zoomSliderCurrentValue = 1;
    self.fineMoveCurrentH = 0;
    self.fineMoveCurrentV = 0;

    self.setupCSS = function() {
        $('<style>').prop('type', 'text/css').html(''
        + '#image-overlay-controls {'
        + '  background-color: rgba(8, 48, 78, 0.9);'
        + '  border-radius: 4px;'
        + '  color: #eee;'
        + '  padding: 10px;'
        + '}'
        + '#image-overlay-controls input, #image-overlay-controls button {'
        + '  width: 100%;'
        + '  margin-bottom: 10px;'
        + '}'
        + '#image-overlay-controls label {'
        + '  display: block;'
        + '  margin-bottom: 5px;'
        + '}'
        + '#image-zoom-buttons, #image-move-controls {'
        + '  display: flex;'
        + '  justify-content: space-between;'
        + '}'
        + '#image-zoom-buttons button, #image-move-controls button {'
        + '  width: 30%;'
        + '}'
        + '#image-rotation {'
        + '  width: 100%;'
        + '  margin-bottom: 10px;'
        + '}'
        + '#image-lat, #image-lng {'
        + '  width: 45%;'
        + '}'
        + '#view-image {'
        + '  width: auto;'
        + '  margin-left: 10px;'
        + '}'
        ).appendTo('head');
    };

    self.setupUI = function() {
        var container = $('<div id="image-overlay-dialog">').appendTo('body');

        container.dialog({
            autoOpen: false,
            title: 'Image Overlay Controls',
            width: 300,
            position: { my: "left top", at: "left+60 top+20", of: "#map" }
        });

        $('<div>')
            .attr('id', 'image-overlay-controls')
            .html(''
            + '<label for="image-url">Image URL:</label>'
            + '<input id="image-url" type="text" placeholder="Enter image URL">'
            + '<label for="image-file">Or choose a file:</label>'
            + '<input id="image-file" type="file" accept="image/*">'
            + '<label for="image-opacity">Opacity:</label>'
            + '<input id="image-opacity" type="range" min="0" max="1" step="0.1" value="0.5">'
            + '<label for="image-zoom">Fine Zoom:</label>'
            + '<input id="image-zoom" type="range" min="-0.5" max="0.5" step="0.01" value="0">'
            + '<div id="image-zoom-buttons">'
            + '  <button id="zoom-out">Smaller</button>'
            + '  <button id="zoom-reset">Reset</button>'
            + '  <button id="zoom-in">Larger</button>'
            + '</div>'
            + '<div id="image-move-controls">'
            + '  <button id="move-north">▲</button>'
            + '  <button id="move-west">◀</button>'
            + '  <button id="move-east">▶</button>'
            + '  <button id="move-south">▼</button>'
            + '</div>'
            + '<label for="move-fine-h">Fine Move:</label>'
            + '<input id="move-fine-h" type="range" min="-1" max="1" step="0.01" value="0">'
            + '<input id="move-fine-v" type="range" min="-1" max="1" step="0.01" value="0">'
//          + '<label for="image-rotation">Rotation:</label>'
//          + '<input id="image-rotation" type="range" min="-180" max="180" step="1" value="0">'
            + '<button id="apply-image">Apply Image</button>'
            + '<button id="remove-image">Remove Image</button>'
            + '<label>Center: </label>'
            + '<input id="image-lat" type="number" step="0.000001">'
            + '<input id="image-lng" type="number" step="0.000001">'
            + '<button id="view-image">View</button>'
            + '<p>Width: <span id="image-width"></span>, Height: <span id="image-height"></span></p>'
            + '<p><small>Note: Please ensure you have the right to use any images you overlay.</small></p>')
            .appendTo(container);

        $('#image-url').on('change', function() {
            // Only remember that the user typed a URL; applyImage() picks it up.
            // Setting self.imageUrl here would stop applyImage() noticing the change.
            self.isLocal = false;
        });

        $('#image-file').on('change', function() {
            var input = this;
            var file = input.files && input.files[0];
            if (!file) return;

            var reader = new FileReader();
            reader.onload = function(e) {
                // Downscale big images so they fit in localStorage and render quickly
                var img = new Image();
                img.onload = function() {
                    var maxDim = 2048;
                    var scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
                    var canvas = document.createElement('canvas');
                    canvas.width = Math.round(img.naturalWidth * scale);
                    canvas.height = Math.round(img.naturalHeight * scale);
                    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);

                    // JPEG is much smaller for photos; everything else stays PNG
                    // so transparency (PNG, GIF, WebP, SVG) is kept
                    var isJpeg = file.type === 'image/jpeg';
                    self.imageUrl = isJpeg ? canvas.toDataURL('image/jpeg', 0.85)
                                           : canvas.toDataURL('image/png');
                    self.isLocal = true;
                    self.imageBounds = null; // new image, so place it fresh on the map
                    self.baseWidth = null;
                    $('#image-url').val('(local) ' + file.name);
                    self.applyImage();

                    // Allow picking the same file again later
                    input.value = '';
                };
                img.onerror = function() { alert('Could not read that image file.'); };
                img.src = e.target.result;
            };
            reader.onerror = function() { alert('Could not read that file.'); };
            reader.readAsDataURL(file);
        });

        $('#apply-image').click(self.applyImage);
        $('#remove-image').click(self.removeImage);
        $('#image-opacity').on('input', function() {
            self.imageOpacity = parseFloat($(this).val());
            if (self.imageOverlay) {
                self.imageOverlay.setOpacity(self.imageOpacity);
            }
            self.saveState();
        });

        $('#image-zoom').on('input', function() {
            var zoomSliderNewValue = Math.exp(parseFloat($(this).val()));
            self.imageZoom *= zoomSliderNewValue / self.zoomSliderCurrentValue;
            self.zoomSliderCurrentValue = zoomSliderNewValue;
            self.updateImageBounds();
        });
        $('#zoom-out').click(function() { self.adjustZoom(0.8); });
        $('#zoom-reset').click(self.resetZoom);
        $('#zoom-in').click(function() { self.adjustZoom(1.25); });

        $('#move-north').click(function() { self.moveImage(0, 0.5); });
        $('#move-south').click(function() { self.moveImage(0, -0.5); });
        $('#move-east').click(function() { self.moveImage(0.5, 0); });
        $('#move-west').click(function() { self.moveImage(-0.5, 0); });

        $('#move-fine-h').on('input', function() {
            var newValue = parseFloat($(this).val());
            var delta = newValue - self.fineMoveCurrentH;
            self.moveImage(delta, 0); // Move horizontally based on the change
            self.fineMoveCurrentH = newValue;
        });

        $('#move-fine-v').on('input', function() {
            var newValue = parseFloat($(this).val());
            var delta = newValue - self.fineMoveCurrentV;
            self.moveImage(0, delta); // Move vertically based on the change
            self.fineMoveCurrentV = newValue;
        });

        $('#image-rotation').on('input', function() {
            self.imageRotation = parseInt($(this).val());
            if (self.imageOverlay) {
//              self.imageOverlay.getElement().style.transform = `rotate(${self.imageRotation}deg)`;
            }
            self.saveState();
        });

        $('#image-lat, #image-lng').on('change', function() {
            var lat = parseFloat($('#image-lat').val());
            var lng = parseFloat($('#image-lng').val());
            if (isNaN(lat) || isNaN(lng)) return;
            self.updateImagePosition(lat, lng);
        });

        $('#view-image').click(self.panToImage);

        var link = $('<a>')
            .html('Image Overlay')
            .click(function() {
                container.dialog('open');
            });

        if (window.useAppPanes()) {
            link.appendTo($('#sidebartoggle'));
        } else {
            link.appendTo($('#toolbox'));
        }
    };

    self.dialogClosedCallback = function() {
        // Any cleanup needed when dialog is closed
    };

    self.resetSliders = function() {
        $('#move-fine-h, #move-fine-v').val(0);
        self.fineMoveCurrentH = 0;
        self.fineMoveCurrentV = 0;
        $('#image-zoom').val(0);
        self.zoomSliderCurrentValue = 1;
    };

    self.applyImage = function() {
        var newUrl = self.isLocal ? self.imageUrl : $('#image-url').val();
        if (!newUrl) {
            alert('Please enter an image URL or choose a file');
            return;
        }

        // A different image may have a different aspect ratio, so start fresh
        if (newUrl !== self.imageUrl) {
            self.imageBounds = null;
            self.baseWidth = null;
        }
        self.imageUrl = newUrl;

        if (self.imageOverlay) {
            self.layerGroup.removeLayer(self.imageOverlay);
            self.imageOverlay = null;
        }

        var img = new Image();
        img.onload = function() {
            self.imageAspectRatio = this.naturalWidth / this.naturalHeight;
            self.createImageOverlay();
        };
        img.onerror = function() {
            alert('Failed to load image. Please check the URL and try again.');
        };
        img.src = self.imageUrl;
        self.resetSliders();
    };

    self.createImageOverlay = function() {
        if (!self.imageBounds) {
            var mapCenter = map.getCenter();
            var mapBounds = map.getBounds();
            var mapWidth = mapBounds.getEast() - mapBounds.getWest();

            var imageWidth = mapWidth / 4;
            var imageHeight = imageWidth / self.imageAspectRatio * Math.cos(Math.PI / 180 * mapCenter.lat);

            self.imageBounds = [
                [mapCenter.lat - imageHeight/2, mapCenter.lng - imageWidth/2],
                [mapCenter.lat + imageHeight/2, mapCenter.lng + imageWidth/2]
            ];
            self.baseWidth = imageWidth;
        }
        if (!self.baseWidth) {
            self.baseWidth = self.imageBounds[1][1] - self.imageBounds[0][1];
        }

        self.imageOverlay = L.imageOverlay(self.imageUrl, self.imageBounds, {
            opacity: self.imageOpacity,
            interactive: true
//          transform: `rotate(${self.imageRotation}deg)`
        });

        if (!self.layerGroup) {
            self.layerGroup = new L.LayerGroup();
            window.addLayerGroup('Image Overlay', self.layerGroup, true);
        }

        self.layerGroup.addLayer(self.imageOverlay);

        self.updateImageInfo();
        self.saveState();
    };

    self.removeImage = function() {
        if (self.imageOverlay) {
            self.layerGroup.removeLayer(self.imageOverlay);
            self.imageOverlay = null;
        }
        self.imageBounds = null;
        self.baseWidth = null;
        self.imageUrl = '';
        self.isLocal = false;
        $('#image-url').val('');
        $('#image-file').val('');
        self.updateImageInfo();
        self.saveState();
        self.resetSliders();
    };

    self.moveImage = function(percentLng, percentLat) {
        if (!self.imageOverlay) return;

        var currentBounds = self.imageOverlay.getBounds();
        var width = currentBounds.getEast() - currentBounds.getWest();
        var height = currentBounds.getNorth() - currentBounds.getSouth();

        var deltaLng = width * percentLng;
        var deltaLat = height * percentLat;

        var currentSouth = currentBounds.getSouth();
        var currentNorth = currentBounds.getNorth();
        var currentCentre = (currentSouth + currentNorth) / 2;
        var currentHeight = currentNorth - currentSouth;
        var newCentre = currentCentre + deltaLat;
        var newHeight = currentHeight / Math.cos(Math.PI / 180 * currentCentre) * Math.cos(Math.PI / 180 * newCentre);
        var newBounds = [
            [newCentre - newHeight/2, currentBounds.getWest() + deltaLng],
            [newCentre + newHeight/2, currentBounds.getEast() + deltaLng]
        ];

        self.imageBounds = newBounds;
        self.imageOverlay.setBounds(self.imageBounds);
//      self.imageOverlay.getElement().style.transform = `rotate(${self.imageRotation}deg)`
        self.updateImageInfo();
        self.saveState();
    };

    self.updateImagePosition = function(lat, lng) {
        if (!self.imageOverlay) return;

        var currentBounds = self.imageOverlay.getBounds();
        var width = currentBounds.getEast() - currentBounds.getWest();
        var height = currentBounds.getNorth() - currentBounds.getSouth();

        self.imageBounds = [
            [lat - height/2, lng - width/2],
            [lat + height/2, lng + width/2]
        ];

        self.imageOverlay.setBounds(self.imageBounds);
        self.updateImageInfo();
        self.saveState();
    };

    self.panToImage = function() {
        if (!self.imageOverlay) return;
        var center = self.imageOverlay.getBounds().getCenter();
        map.panTo(center);
    };

    // Back to the width the image had when it was first placed
    self.resetZoom = function() {
        if (!self.imageOverlay || !self.baseWidth) return;
        var b = self.imageOverlay.getBounds();
        var width = b.getEast() - b.getWest();
        $('#image-zoom').val(0);
        self.zoomSliderCurrentValue = 1;
        if (width > 0) self.adjustZoom(self.baseWidth / width);
    };

    self.adjustZoom = function(factor) {
        self.imageZoom *= factor;
        self.updateImageBounds();
    };

    self.updateImageBounds = function() {
        if (!self.imageOverlay) return;

        var currentBounds = self.imageOverlay.getBounds();
        var currentCenter = currentBounds.getCenter();

        var width = (currentBounds.getEast() - currentBounds.getWest()) * self.imageZoom;
        var height = width / self.imageAspectRatio * Math.cos(Math.PI / 180 * currentCenter.lat);

        self.imageBounds = [
            [currentCenter.lat - height/2, currentCenter.lng - width/2],
            [currentCenter.lat + height/2, currentCenter.lng + width/2]
        ];

        self.imageOverlay.setBounds(self.imageBounds);
//      self.imageOverlay.getElement().style.transform = `rotate(${self.imageRotation}deg)`
        self.updateImageInfo();
        self.saveState();
        self.imageZoom = 1;
    };

    self.updateImageInfo = function() {
        if (self.imageBounds && self.imageOverlay) {
            var center = self.imageOverlay.getBounds().getCenter();
            $('#image-lat').val(center.lat.toFixed(6));
            $('#image-lng').val(center.lng.toFixed(6));

            var widthMeters = map.distance(
                L.latLng(self.imageBounds[0][0], self.imageBounds[0][1]),
                L.latLng(self.imageBounds[0][0], self.imageBounds[1][1])
            );
            var heightMeters = map.distance(
                L.latLng(self.imageBounds[0][0], self.imageBounds[0][1]),
                L.latLng(self.imageBounds[1][0], self.imageBounds[0][1])
            );

            $('#image-width').text(self.formatDistance(widthMeters));
            $('#image-height').text(self.formatDistance(heightMeters));
        } else {
            $('#image-lat, #image-lng').val('');
            $('#image-width, #image-height').text('');
        }
    };

    self.formatDistance = function(meters) {
        if (meters >= 2000) {
            return (meters / 1000).toFixed(2) + ' km';
        } else {
            return meters.toFixed(0) + ' m';
        }
    };

    self.saveState = function() {
        var state = {
            version: 1,
            imageUrl: self.imageUrl,
            imageBounds: self.imageBounds ? [
                [self.imageBounds[0][0], self.imageBounds[0][1]],
                [self.imageBounds[1][0], self.imageBounds[1][1]]
            ] : null,
            imageOpacity: self.imageOpacity,
            imageZoom: self.imageZoom,
            baseWidth: self.baseWidth
//          imageRotation: self.imageRotation
        };
        try {
            localStorage.setItem('plugin-imageOverlay-state', JSON.stringify(state));
        } catch (e) {
            // Most likely a local image too large for localStorage.
            // Don't leave the previous state behind, or the old image would come back on reload.
            console.warn('Image Overlay: could not save state', e);
            try {
                localStorage.removeItem('plugin-imageOverlay-state');
            } catch (e2) {}
            if (self.saveWarnedFor !== self.imageUrl) {
                self.saveWarnedFor = self.imageUrl;
                alert('This image is too large to save in the browser. '
                    + 'It will stay on the map for now, but will be gone after you reload the page.');
            }
        }
    };

    self.loadState = function() {
        var stateJson;
        try {
            stateJson = localStorage.getItem('plugin-imageOverlay-state');
        } catch (e) {
            return;
        }
        if (!stateJson) return;

        var state;
        try {
            state = JSON.parse(stateJson);
        } catch (e) {
            console.warn('Image Overlay: saved state is corrupt, ignoring', e);
            return;
        }

        if (state && state.version === 1) {
            self.imageUrl = state.imageUrl || '';
            self.imageBounds = state.imageBounds;
            self.imageOpacity = (typeof state.imageOpacity === 'number') ? state.imageOpacity : 0.5;
            self.imageZoom = 1; // zoom is applied immediately and reset, so never restore it
            self.baseWidth = (typeof state.baseWidth === 'number') ? state.baseWidth : null;
            self.imageRotation = 0;

            self.isLocal = self.imageUrl.indexOf('data:') === 0;
            $('#image-url').val(self.isLocal ? '(saved local image)' : self.imageUrl);
            $('#image-opacity').val(self.imageOpacity);
            $('#image-zoom').val(0);
            $('#image-rotation').val(self.imageRotation);

            if (self.imageUrl && self.imageBounds) {
                // Work out the aspect ratio from the saved bounds so zooming
                // keeps the right shape without waiting for the image to load
                var b = self.imageBounds;
                var midLat = (b[0][0] + b[1][0]) / 2;
                var w = b[1][1] - b[0][1];
                var h = b[1][0] - b[0][0];
                if (h > 0) {
                    self.imageAspectRatio = w / h * Math.cos(Math.PI / 180 * midLat);
                }
                self.createImageOverlay();
            }
        }
    };

    var setup = function() {
        self.setupCSS();
        self.setupUI();
        self.layerGroup = new L.LayerGroup();
        window.addLayerGroup('Image Overlay', self.layerGroup, true);
        self.loadState();
    };

    // PLUGIN END //////////////////////////////////////////////////////////

    setup.info = plugin_info; //add the script info data to the function as a property
    if (!window.bootPlugins) window.bootPlugins = [];
    window.bootPlugins.push(setup);
    // if IITC has already booted, immediately run the 'setup' function
    if (window.iitcLoaded && typeof setup === 'function') setup();
}

// wrapper end
(function() {
    var plugin_info = {};
    if (typeof GM_info !== 'undefined' && GM_info && GM_info.script) {
        plugin_info.script = {
            version: GM_info.script.version,
            name: GM_info.script.name,
            description: GM_info.script.description
        };
    }
    // Greasemonkey. It will be quite hard to debug
    if (typeof unsafeWindow != 'undefined' || typeof GM_info == 'undefined' || GM_info.scriptHandler != 'Tampermonkey') {
        // inject code into site context
        var script = document.createElement('script');
        script.appendChild(document.createTextNode('('+ wrapper +')('+JSON.stringify(plugin_info)+');'));
        (document.body || document.head || document.documentElement).appendChild(script);
    } else {
        // Tampermonkey, run code directly
        wrapper(plugin_info);
    }
})();
