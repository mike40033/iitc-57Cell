// ==UserScript==
// @id             iitc-plugin-homogeneous-fields@57Cell
// @name           IITC Plugin: 57Cell's Polygon Portal Counter
// @version        0.4.0.20240803
// @description    Plugin for counting portals in polygons
// @author         57Cell (Michael Hartley) and Claude.AI
// @category       Layer
// @namespace      https://github.com/jonatkins/ingress-intel-total-conversion
// @updateURL      https://github.com/mike40033/iitc-57Cell/raw/master/plugins/polygon-portal-counter/polygon-portal-counter.meta.js
// @downloadURL    https://github.com/mike40033/iitc-57Cell/raw/master/plugins/polygon-portal-counter/polygon-portal-counter.user.js
// @include        https://intel.ingress.com/*
// @include        http://intel.ingress.com/*
// @match          https://intel.ingress.com/*
// @match          http://intel.ingress.com/*
// @include        https://*.ingress.com/intel*
// @include        http://*.ingress.com/intel*
// @match          https://*.ingress.com/intel*
// @match          http://*.ingress.com/intel*
// @include        https://*.ingress.com/mission/*
// @include        http://*.ingress.com/mission/*
// @match          https://*.ingress.com/mission/*
// @match          http://*.ingress.com/mission/*
// @grant        none
// ==/UserScript==

pluginName = "57Cell's Polygon Portal Counter";
version = "0.4.0";
changeLog = [
    {
        version: '0.4.0.20240803',
        changes: [
            'Initial release',
        ],
    },
];

function wrapper(plugin_info) {
    if (typeof window.plugin !== 'function') window.plugin = function() {};

    plugin_info.buildName = '';
    plugin_info.dateTimeVersion = '2024-08-03-180000';
    plugin_info.pluginId = '57CellsPolygonPortalCounter';


    window.plugin.polygonPortalCounter = function() {};
    var self = window.plugin.polygonPortalCounter;

    self.layerGroup = null;

    self.countPortalsInPolygon = function(polygon) {
        var count = 0;
        for (var guid in window.portals) {
            var portal = window.portals[guid];
            var latlng = portal.getLatLng();
            if (self.isPointInPolygon(latlng, polygon)) {
                count++;
            }
        }
        return count;
    };

    self.isPointInPolygon = function(point, polygon) {
        var x = point.lat, y = point.lng;
        var inside = false;
        for (var i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
            var xi = polygon[i].lat, yi = polygon[i].lng;
            var xj = polygon[j].lat, yj = polygon[j].lng;
            var intersect = ((yi > y) != (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
            if (intersect) inside = !inside;
        }
        return inside;
    };

    self.getPolygonCenter = function(polygon) {
        var lat = 0, lng = 0, numPoints = 0;

        var processPoints = function(points) {
            for (var i = 0; i < points.length; i++) {
                lat += points[i].lat;
                lng += points[i].lng;
                numPoints++;
            }
        };

        if (Array.isArray(polygon[0])) {
            for (var i = 0; i < polygon.length; i++) {
                processPoints(polygon[i]);
            }
        } else {
            processPoints(polygon);
        }

        if (numPoints === 0) return null;

        return L.latLng(lat / numPoints, lng / numPoints);
    };

    self.updatePortalCounts = function() {
        var content = '<table><tr><th>Polygon</th><th>Portal Count</th><th>Approx. Position</th></tr>';
        self.layerGroup.clearLayers();
        var total = 0;
        for (var layerId in window.plugin.drawTools.drawnItems._layers) {
            var layer = window.plugin.drawTools.drawnItems._layers[layerId];
            if (layer instanceof L.Polygon) {
                var polygonLatLngs = layer.getLatLngs();
                var count = self.countPortalsInPolygon(polygonLatLngs);
                total += count;
                var center = self.getPolygonCenter(polygonLatLngs);
                var linkToPosition = center ? '<a href="#" onclick="window.map.setView([' + center.lat + ',' + center.lng + '], 15); return false;">View</a>' : 'N/A';
                content += '<tr><td>Polygon ' + layerId + '</td><td>' + count + '</td><td>' + linkToPosition + '</td></tr>';

                if (center) {
                    L.marker(center, {
                        icon: L.divIcon({
                            className: 'polygon-portal-count',
                            html: '<h1>'+count+'</h1>',
                            iconSize: [80, 40]
                        }),
                        interactive: false
                    }).addTo(self.layerGroup);
                }
            }
        }
        content += '<tr></tr><tr><td><b>TOTAL</b></td><td><b>'+total+'</b></td></tr>';
        content += '</table>';
        $('#polygon-portal-counter-content').html(content);
    };

    self.setupUI = function() {
        var container = $('<div id="polygon-portal-counter-dialog">')
            .append('<div id="polygon-portal-counter-content"></div>')
            .appendTo('body');

        var refreshButton = $('<button>')
            .text('Refresh')
            .click(self.updatePortalCounts);

        container.dialog({
            autoOpen: false,
            title: 'Polygon Portal Counter',
            width: 400,
            position: { my: "right top", at: "right-10 top+10", of: "#map" }
        });

        container.parent().find('.ui-dialog-titlebar').append(refreshButton);

        var link = $('<a>')
            .html('Polygon Portal Counter')
            .click(function() {
                self.updatePortalCounts();
                container.dialog('open');
            });

        if (window.useAppPanes()) {
            link.appendTo($('#sidebartoggle'));
        } else {
            link.appendTo($('#toolbox'));
        }

        // Add CSS for the count labels
        $('<style>').prop('type', 'text/css').html('.polygon-portal-count { background-color: rgba(255,255,255,0.7); border: 1px solid #888; border-radius: 5px; font-size: 10px; font-weight: bold; color: #000; text-align: center; line-height: 20px; }').appendTo('head');
    };

    self.setupLayer = function() {
        self.layerGroup = new L.LayerGroup();
        window.addLayerGroup('Polygon Portal Counts', self.layerGroup, true);
    };

    var setup = function() {
        if (window.plugin.drawTools === undefined) {
            alert('Polygon Portal Counter requires draw tools plugin. Please install it first.');
            return;
        }

        self.setupLayer();
        self.setupUI();
        window.addHook('drawTools', self.updatePortalCounts);
        window.map.on('zoom', self.updatePortalCounts);  // Update counts on zoom to handle visibility changes
    };

    setup.info = plugin_info;
    if (!window.bootPlugins) window.bootPlugins = [];
    window.bootPlugins.push(setup);
    if (window.iitcLoaded && typeof setup === 'function') setup();
}

var script = document.createElement('script');
var info = {};
if (typeof GM_info !== 'undefined' && GM_info && GM_info.script) info.script = { version: GM_info.script.version, name: GM_info.script.name, description: GM_info.script.description };
script.appendChild(document.createTextNode('('+ wrapper +')('+JSON.stringify(info)+');'));
(document.body || document.head || document.documentElement).appendChild(script);
