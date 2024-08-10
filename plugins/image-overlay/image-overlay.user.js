// ==UserScript==
// @id             iitc-plugin-image-overlay@57Cell
// @name           IITC Plugin: 57Cell's Image Overlay
// @version        0.1.4.20240807
// @description    Plugin for overlaying and adjusting images on the map
// @author         57Cell (Michael Hartley) and Claude.AI
// @category       Layer
// @namespace      https://github.com/jonatkins/ingress-intel-total-conversion
// @updateURL      https://github.com/mike40033/iitc-57Cell/raw/master/plugins/image-overlay/image-overlay.meta.js
// @downloadURL    https://github.com/mike40033/iitc-57Cell/raw/master/plugins/image-overlay/image-overlay.user.js
// @include        https://*.ingress.com/intel*
// @include        http://*.ingress.com/intel*
// @match          https://*.ingress.com/intel*
// @match          http://*.ingress.com/intel*
// @include        https://*.ingress.com/mission/*
// @include        http://*.ingress.com/mission/*
// @match          https://*.ingress.com/mission/*
// @match          http://*.ingress.com/mission/*
// @grant          none
// ==/UserScript==

var pluginName = "57Cell's Image Overlay";
var version = "0.1.4";
var changeLog = [
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
    // ... previous changelog entries ...
];

function wrapper(plugin_info) {
    if (typeof window.plugin !== 'function') window.plugin = function() {};
    plugin_info.buildName = '';
    plugin_info.dateTimeVersion = '2024-08-07-180000';
    plugin_info.pluginId = '57CellsImageOverlay';

    // PLUGIN START ////////////////////////////////////////////////////////

    window.plugin.imageOverlay = function() {};
    var self = window.plugin.imageOverlay;

    self.imageOverlay = null;
    self.imageUrl = '';
    self.imageBounds = null;
    self.imageOpacity = 0.5;
    self.layerGroup = null;
    self.imageAspectRatio = 1;
    self.imageZoom = 1;

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
        var container = $('<div id="image-overlay-dialog">')
            .append('<div id="image-overlay-controls"></div>')
            .appendTo('body');

        container.dialog({
            autoOpen: false,
            title: 'Image Overlay Controls',
            width: 300,
            position: { my: "left top", at: "left+60 top+20", of: "#map" }
        });

        var controlsHTML = $('<div>')
            .attr('id', 'image-overlay-controls')
            .html(''
            + '<label for="image-url">Image URL:</label>'
            + '<input id="image-url" type="text" placeholder="Enter image URL">'
            + '<label for="image-opacity">Opacity:</label>'
            + '<input id="image-opacity" type="range" min="0" max="1" step="0.1" value="0.5">'
            + '<label for="image-zoom">Fine Zoom:</label>'
            + '<input id="image-zoom" type="range" min="-0.5" max="0.5" step="0.01" value="1">'
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
            + '<p><small>Note: Please ensure you have the right to use any images you overlay.</small></p>'
            + '</div>')
            .appendTo(container);


        $('#image-url').on('change', function() {
            self.imageUrl = $(this).val();
            self.saveState();
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
        self.zoomSliderCurrentValue = 1;
        $('#image-zoom').on('input', function() {
            let zoomSliderNewValue = Math.exp(parseFloat($(this).val()));
            self.imageZoom *= zoomSliderNewValue / self.zoomSliderCurrentValue;
            self.zoomSliderCurrentValue = zoomSliderNewValue;
            self.updateImageBounds();
        });
        $('#zoom-out').click(function() { self.adjustZoom(0.8); });
        $('#zoom-reset').click(function() { self.adjustZoom(1 / self.imageZoom); });
        $('#zoom-in').click(function() { self.adjustZoom(1.25); });

        $('#move-north').click(() => self.moveImage(0, 0.5));
        $('#move-south').click(() => self.moveImage(0, -0.5));
        $('#move-east').click(() => self.moveImage(0.5, 0));
        $('#move-west').click(() => self.moveImage(-0.5, 0));

        self.fineMoveCurrentH = 0;
        self.fineMoveCurrentV = 0;

        $('#move-fine-h').on('input', function() {
            var newValue = parseFloat($(this).val());
            var delta = newValue - self.fineMoveCurrentH;
            self.moveImage(delta, 0); // Move horizontally based on the change
            self.fineMoveCurrentH = newValue;
        });

        $('#move-fine-v').on('input', function() {
            var newValue = parseFloat($(this).val());
            var delta = newValue - self.fineMoveCurrentV;
            self.moveImage(0, delta); // Move horizontally based on the change
            self.fineMoveCurrentV = newValue;
        });

        self.imageRotation = 0;

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

    self.showDialog = function() {
        self.dialog.dialog('open');
    };

    self.dialogClosedCallback = function() {
        // Any cleanup needed when dialog is closed
    };

    self.resetSliders = function() {
        $('#move-fine').val(0);
        self.fineMoveCurrent = 0;
        $('#image-zoom').val(0);
        self.zoomSliderCurrentValue = 1;
    };

    self.applyImage = function() {
        self.imageUrl = $('#image-url').val();
        if (!self.imageUrl) {
            alert('Please enter an image URL');
            return;
        }

        if (self.imageOverlay) {
            self.layerGroup.removeLayer(self.imageOverlay);
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
            var mapHeight = mapBounds.getNorth() - mapBounds.getSouth();

            var imageWidth = mapWidth / 4;
            var imageHeight = imageWidth / self.imageAspectRatio * Math.cos(Math.PI / 180 * mapCenter.lat);

            self.imageBounds = [
                [mapCenter.lat - imageHeight/2, mapCenter.lng - imageWidth/2],
                [mapCenter.lat + imageHeight/2, mapCenter.lng + imageWidth/2]
            ];
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
            self.imageBounds = null;
            self.updateImageInfo();
            self.saveState();
            self.resetSliders();
        }
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
        var currentCentre = (currentSouth + currentNorth)/2;
        var currentHeight = currentNorth - currentSouth;
        var newCentre = currentCentre + deltaLat;
        var newHeight = currentHeight / Math.cos(Math.PI / 180 * currentCentre) *  Math.cos(Math.PI / 180 * newCentre);
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
//        self.imageOverlay.getElement().style.transform = `rotate(${self.imageRotation}deg)`
        self.updateImageInfo();
        self.saveState();
        self.imageZoom = 1;
    };

    self.updateImageInfo = function() {
        if (self.imageBounds) {
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
            $('#image-lat, #image-lng, #image-width, #image-height').text('');
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
            imageZoom: self.imageZoom
//          imageRotation: self.imageRotation
        };
        localStorage.setItem('plugin-imageOverlay-state', JSON.stringify(state));
    };

    self.loadState = function() {
        var stateJson = localStorage.getItem('plugin-imageOverlay-state');
        if (stateJson) {
            var state = JSON.parse(stateJson);
            if (state.version === 1) {
                self.imageUrl = state.imageUrl;
                self.imageBounds = state.imageBounds;
                self.imageOpacity = state.imageOpacity;
                self.imageZoom = state.imageZoom;
//              self.imageRotation = state.imageRotation || 0;
                self.imageRotation = 0;
                $('#image-url').val(self.imageUrl);
                $('#image-opacity').val(self.imageOpacity);
                $('#image-zoom').val(0);
                $('#image-rotation').val(self.imageRotation);

                if (self.imageUrl && self.imageBounds) {
                    self.createImageOverlay();
                }
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
