// ==UserScript==
// @id             iitc-plugin-drone-planner@57Cell
// @name           IITC Plugin: 57Cell's Drone Flight Planner
// @version        1.0.0.20250817
// @description    Plugin for planning drone flights in IITC
// @author         57Cell (Michael Hartley) and ChatGPT 4.0
// @category       Layer
// @namespace      https://github.com/jonatkins/ingress-intel-total-conversion
// @updateURL      https://github.com/mike40033/iitc-57Cell/raw/master/plugins/drone-flight-planner/drone-flight-planner.meta.js
// @downloadURL    https://github.com/mike40033/iitc-57Cell/raw/master/plugins/drone-flight-planner/drone-flight-planner.user.js
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

pluginName = "57Cell's Drone Planner";
version = "1.0.0";
changeLog = [
    {
        version: '1.0.0.20250816',
        changes: [
            'NEW: Initial Public Release',
        ],
    },
];

function wrapper(plugin_info) {
    if (typeof window.plugin !== 'function') window.plugin = function() {};
    plugin_info.buildName = '';
    plugin_info.dateTimeVersion = '2025-08-16-151500';
    plugin_info.pluginId = '57CellsDronePlanner';

    // PLUGIN START
    console.log('loading drone plugin')
    var changelog = changeLog;
    let self = window.plugin.dronePlanner = function() {};

    // helper function to convert portal ID to portal object
    function portalIdToObject(portalId) {
        let portals = self.allPortals; // IITC global object that contains all portal data
        let portal = portals[portalId] ? portals[portalId].options.data : null;

        // Convert portal to the structure expected by populatePortalData
        if (portal) {
            let lat = parseFloat(portal.latE6 / 1e6);
            let lng = parseFloat(portal.lngE6 / 1e6);
            return {
                id: portalId, // ID of the portal
                name: portal.title, // title of the portal
                latLng: new L.latLng(lat,lng), // use LatLng Class to stay more flexible
            };
        }

        return null;
    }

    // layerGroup for the draws
    self.linksLayerGroup = null;
    self.fieldsLayerGroup = null;
    self.highlightLayergroup = null;

    self.allPortals = {};
    self.graph = {};

    self.scanPortalsAndUpdateGraph = function() {
        let graph = self.graph;
        const MAX_DISTANCE = 1250; // Reuse this constant if it's globally defined
        var bounds = map.getBounds(); // Current map view bounds

        for (let key in window.portals) {
            var portal = window.portals[key]; // Retrieve the portal object
            var portalLatLng = portal.getLatLng(); // Portal's latitude and longitude
            if (!self.allPortals.hasOwnProperty(key) && bounds.contains(portalLatLng)) {
                self.allPortals[key] = portal; // Add new portal

                // Initialize graph entry for the new portal
                graph[key] = [];

                // Check distance to all other portals in self.allPortals
                for (let otherKey in self.allPortals) {
                    if (key !== otherKey) {
                        let distance = self.getDistance(key, otherKey);
                        if (distance <= MAX_DISTANCE) {
                            // Add bidirectional edges for close portals
                            graph[key].push(otherKey);
                            if (!graph[otherKey].includes(key)) { // Prevent duplicate entries
                                graph[otherKey].push(key);
                            }
                        }
                    }
                }
            }
        }
        self.updatePlan();
    }

    // TODO: make linkStyle editable in options dialog
    self.linkStyle = {
        color: '#FF0000',
        opacity: 1,
        weight: 1.5,
        clickable: false,
        interactive: false,
        smoothFactor: 10,
        dashArray: [12, 5, 4, 5, 6, 5, 8, 5, "100000" ],
    };

    // TODO: make fieldStyle editable in options dialog
    self.fieldStyle = {
        stroke: false,
        fill: true,
        fillColor: '#FF0000',
        fillOpacity: 0.1,
        clickable: false,
        interactive: false,
    };

    self.updatePlan = function() {
        $("#hcf-plan-text").val("Please wait...");

        if (!self.startPortal) {
            $("#hcf-plan-text").val("Please click on a start portal...");
            return;
        }
        let graph = self.graph;
        console.time("A* Time");
        self.plan = self.findMinimumCostPath(graph);
        console.timeEnd("A* Time");

        console.time("update Layer Time");
        self.updateLayer();
        console.timeEnd("update Layer Time");
    }

    self.findMinimumCostPath = function(graph) {
        console.time("spanning tree Time");
        let pnfp = self.createSpanningTreeAndFindFurthestPortal(graph);
        let previousNodes = pnfp.pn;
        let furthestPortal = pnfp.fp;
        console.timeEnd("spanning tree Time");
        console.time("construct tree Time");
        let tree = self.constructTree(previousNodes);
        console.timeEnd("construct tree Time");
        console.time("furthest path Time");
        if (document.getElementById('opt-none').checked) {
            tree.furthestPath = self.reconstructPath(previousNodes, furthestPortal);
        } else {
            tree.furthestPath = self.applyAStar(graph, self.startPortal.guid, furthestPortal, self.heuristic);
        }
        console.timeEnd("furthest path Time");

        return tree;
    };

    self.createSpanningTreeAndFindFurthestPortal = function(graph) {
        let previousNodes = {};
        let visited = new Set();
        visited.add(self.startPortal.guid);
        let queue = [self.startPortal.guid];
        let furthestPortal = self.startPortal.guid;
        let maxDistance = 0;
        let longHopThreshold = self.getLongHopThreshold();
        while (queue.length > 0) {
            let current = queue.shift();
            let currentDistance = self.getDistance(self.startPortal.guid, current);
            if (currentDistance > maxDistance) {
                maxDistance = currentDistance;
                furthestPortal = current;
            }

            if (graph[current]) {
                graph[current].forEach(neighbor => {
                    if (!visited.has(neighbor)) {
                        visited.add(neighbor);
                        previousNodes[neighbor] = current;
                        let distance = self.getDistance(current, neighbor);
                        let isShortHop = distance <= longHopThreshold;
                        if (isShortHop) {
                            queue.unshift(neighbor);
                        } else {
                            queue.push(neighbor);
                        }
                    }
                });
            }
        }
        let rtn = {pn: previousNodes, fp:furthestPortal};
        return rtn;
    };

    self.getOptimisationScale = function() {
        if (document.getElementById('opt-perfect') && document.getElementById('opt-perfect').checked) {
            return 1;
        } else if (document.getElementById('opt-balanced').checked) {
            return 3;
        } else if (document.getElementById('opt-greedy').checked) {
            return 10;
        } else {
            // 'None' or no option selected, default or undefined behavior
            return undefined; // Or any other default value you'd prefer
        }
    }

    self.heuristic = function (node, goal) {
        let distMetres = self.getDistance(node, goal);
        let longHopThreshold = self.getLongHopThreshold();
        // Calculate the total cost assuming only short hops
        let shortHopCost = self.getCostFromHops(0,Math.ceil(distMetres / longHopThreshold))

        // Calculate the maximum number of long and short hops
        let numLongHops = Math.floor(distMetres / 1250); // 1.25km max hop length
        let numShortHops = 0;
        if (distMetres - 1250*numLongHops > longHopThreshold) {
            numLongHops++;
        } else {
            numShortHops++;
        }
        // Calculate the total cost assuming all (or mostly) long hops
        let longHopCost = self.getCostFromHops(numLongHops,numShortHops);

        let scale = self.getOptimisationScale();


        // Return the minimum of the two costs
        return Math.min(longHopCost, shortHopCost) * scale;
    }

    self.applyAStar = function(graph, start, end, heuristic) {
        let openSet = [start]; // Open set as a list
        let cameFrom = {};
        let gScore = { [start]: 0 };
        let fScore = { [start]: heuristic(start, end) }; // Initialize fScore for start node
        let longHopThreshold = self.getLongHopThreshold();

        while (openSet.length > 0) {
            // Sort the open set based on fScore
            openSet.sort((a, b) => fScore[a] - fScore[b]);
            let current = openSet.shift();
            if (current === end) {
                console.time("reconstructPath");
                let rtn = self.reconstructPath(cameFrom, current);
                console.timeEnd("reconstructPath");
                return rtn;
            }

            graph[current].forEach(neighbor => {
                let distance = self.getDistance(current, neighbor);
                let isLongHop = distance > longHopThreshold;
                let cost = isLongHop ? self.getCostFromHops(1, 0) : self.getCostFromHops(0, 1);
                let tentative_gScore = gScore[current] + cost;
                if (!gScore.hasOwnProperty(neighbor) || tentative_gScore < gScore[neighbor]) {
                    cameFrom[neighbor] = current;
                    gScore[neighbor] = tentative_gScore;
                    let tentative_fScore = gScore[neighbor] + heuristic(neighbor, end);
                    if (!fScore.hasOwnProperty(neighbor)) {
                        fScore[neighbor] = tentative_fScore;
                        openSet.push(neighbor);
                    } else if (tentative_fScore < fScore[neighbor]) {
                        fScore[neighbor] = tentative_fScore;
                    }
                }
            });
        }

        return [];
    };

    self.reconstructPath = function(cameFrom, current) {
        let totalPath = [current];
        while (Object.keys(cameFrom).includes(current)) {
            current = cameFrom[current];
            totalPath.unshift(current);
            if (totalPath.length > 1000) return [current];
        }
        return totalPath;
    };

    self.getLongHopThreshold = function() {
        return parseInt(document.getElementById('long-hop-length').value);
    }

    self.getCostFromHops = function(longHops, shortHops) {
        const PENALTY_MIN_HOPS = 1.01;
        const PENALTY_BALANCED = 3; // You can adjust this later as needed
        const PENALTY_MIN_LONG_HOPS = 100;

        let pathType = document.querySelector('input[name="path-type"]:checked').value;
        let penalty;

        switch (pathType) {
            case 'min-long-hops':
                penalty = PENALTY_MIN_LONG_HOPS;
                break;
            case 'min-hops':
                penalty = PENALTY_MIN_HOPS;
                break;
            case 'balanced':
                penalty = PENALTY_BALANCED;
                break;
            default:
                penalty = PENALTY_BALANCED; // Default case, can be adjusted
        }

        let rtn = shortHops + (longHops * penalty);
        return rtn;
    };

    self.constructTree = function(previousNodes, hops = {}) {
        let tree = {};
        for (let key in previousNodes) {
            tree[key] = {
                parent: previousNodes[key],
                longHops: hops[key] ? hops[key].long : 0,
                shortHops: hops[key] ? hops[key].short : 0
            };
        }
        return tree;
    };

    self.exportPlanAsText = function() {
        let totalHops = self.plan.furthestPath.length - 1; // Number of hops is one less than the number of portals
        let longHops = 0;
        let longHopThreshold = parseInt(document.getElementById('long-hop-length').value);

        let totalDistance = self.getDistance(self.plan.furthestPath[0], self.plan.furthestPath.slice(-1)[0]);

        for (let i = 0; i < self.plan.furthestPath.length - 1; i++) {
            let distance = self.getDistance(self.plan.furthestPath[i], self.plan.furthestPath[i+1]);
            if (distance > longHopThreshold) {
                longHops++;
            }
        }

        // Convert total distance to kilometers
        totalDistance = totalDistance / 1000;

        // Update the text with the calculated values
        let message = totalDistance.toFixed(2) + " km path found, with " + totalHops + " hops total, and " + longHops + " long hops\n\n";
        for (let i = 0; i < self.plan.furthestPath.length; i++) {
            let distance = i == 0 ? 0 : self.getDistance(self.plan.furthestPath[i], self.plan.furthestPath[i-1]);
            let longHop = (distance > longHopThreshold);
            let prefix = i == 0 ? "Place drone at " : "Move drone to ";
            let portalName = self.getPortalNameFromGUID(self.plan.furthestPath[i]);
            let line = i + ". " + prefix + portalName;
            if (longHop) {
                line += " (Long hop: might need a key)";
            }
            line += " ";
            let flightDistance = self.getDistance(self.plan.furthestPath[i], self.plan.furthestPath[0]) / 1000;
            line += flightDistance.toFixed(2)+"km so far";
            message += line + "\n";
        }
        return message;
    }

    self.getPortalNameFromGUID = function(guid) {
        let portalData = self.allPortals[guid];

        if (portalData && portalData.options && portalData.options.data && portalData.options.data.title) {
            // Return the portal's name if it's available
            return portalData.options.data.title;
        } else {
            // If the name isn't available, use the lat/lng as a fallback
            let latLng = self.getLatLng(guid);
            if (latLng) {
                return "?? Portal at " + latLng.lat.toFixed(6) + ", " + latLng.lng.toFixed(6);
            } else {
                return "Unknown Portal";
            }
        }
    };

    self.updateLayer = function() {
        if (self.plan && self.plan.furthestPath) {
            let message = self.exportPlanAsText();
            $("#hcf-plan-text").val(message);
            self.drawLayer();
        } else {
            // Handle case where self.plan or self.plan.furthestPath is not available
            $("#hcf-plan-text").val("No plan available.");
        }
    };

    self.drawLayer = function() {
        self.clearLayers();
        // Retrieve color values from color picker widgets
        let shortHopColor = document.getElementById('short-hop-colorPicker').value;
        let longHopColor = document.getElementById('long-hop-colorPicker').value;
        let fullTreeColor = document.getElementById('full-tree-colorPicker').value;
        let longHopThreshold = parseInt(document.getElementById('long-hop-length').value);

        // Function to determine the style based on hop length
        function getStyle(distance, isTree) {
            return {
                color: isTree ? fullTreeColor : distance > longHopThreshold ? longHopColor : shortHopColor,
                opacity: 1,
                weight: isTree ? 1.5 : 4.5,
                clickable: false,
                interactive: false,
                smoothFactor: 10,
                dashArray: [12, 5, 4, 5, 6, 5, 8, 5, "100000"],
            };
        }

        // Draw links in the tree
        for (let guid in self.plan) {
            if (self.plan[guid].parent) {
                let startLatLng = self.getLatLng(guid);
                let endLatLng = self.getLatLng(self.plan[guid].parent);
                let distance = self.getDistance(guid, self.plan[guid].parent);
                self.drawLine(self.linksLayerGroup, startLatLng, endLatLng, getStyle(distance, true));
            }
        }

        // Draw links in the furthest distance path
        for (let i = 0; i < self.plan.furthestPath.length - 1; i++) {
            let startLatLng = self.getLatLng(self.plan.furthestPath[i]);
            let endLatLng = self.getLatLng(self.plan.furthestPath[i + 1]);
            let distance = self.getDistance(self.plan.furthestPath[i], self.plan.furthestPath[i + 1]);
            self.drawLine(self.fieldsLayerGroup, startLatLng, endLatLng, getStyle(distance, false));
        }
    };


    self.setup = function() {
        // Add button to toolbox
        $('#toolbox').append('<a onclick="window.plugin.dronePlanner.openDialog(); return false;">Plan Drone Flight</a>');

        // Add event listener for portal selection
        window.addHook('portalSelected', self.portalSelected);

        self.linksLayerGroup = new L.LayerGroup();
        window.addLayerGroup('All Drone Paths', self.linksLayerGroup, false);

        // window.addLayerGroup('Homogeneous CF Links', self.linksLayerGroup, false);

        self.fieldsLayerGroup = new L.LayerGroup();
        window.addLayerGroup('Longest Drone Path', self.fieldsLayerGroup, false);
        // debugger;
        self.highlightLayergroup = new L.LayerGroup();
        window.addLayerGroup('Start Portal Highlights', self.highlightLayergroup, true);

        window.map.on('overlayadd overlayremove', function() {
            setTimeout(function(){
                self.updateLayer();
            },1);
        });
    };

    self.clearLayers = function() {
        if (window.map.hasLayer(self.linksLayerGroup)) {
            self.linksLayerGroup.clearLayers();
        }
        if (window.map.hasLayer(self.fieldsLayerGroup)) {
            self.fieldsLayerGroup.clearLayers();
        }
        if (window.map.hasLayer(self.highlightLayergroup)) {
            self.highlightLayergroup.clearLayers();
        }
    }

    self.drawLine = function(layerGroup, alatlng, blatlng, style) {
        //check if layer is active
        if (!window.map.hasLayer(layerGroup)) {
            return;
        }
        var poly = L.polyline([alatlng, blatlng], style);
        poly.addTo(layerGroup);
    }

    // function to draw a link to the plugin layer
    self.drawLink = function (alatlng, blatlng, style) {
        self.drawLine(self.linkLayerGroup, alatlng, blatlng, style);
    }

    // function to draw a field to the plugin layer
    self.drawField = function (alatlng, blatlng, clatlng, style) {
        //check if layer is active
        if (!window.map.hasLayer(self.fieldsLayerGroup)) {
            return;
        }

        var poly = L.polygon([alatlng, blatlng, clatlng], style);
        poly.addTo(self.fieldsLayerGroup);

    }

    self.exportDrawtoolsLink = function(p1, p2) {
        let alatlng = self.getLatLng(p1);
        let blatlng = self.getLatLng(p2);
        let distance = self.distance(alatlng, blatlng);
        let opts = {...window.plugin.drawTools.lineOptions};
        let shortHopColor = document.getElementById('short-hop-colorPicker').value;
        let longHopColor = document.getElementById('long-hop-colorPicker').value;
        let longHopThreshold = parseInt(document.getElementById('long-hop-length').value);

        opts.color =distance > longHopThreshold ? longHopColor : shortHopColor;

        let layer = L.geodesicPolyline([alatlng, blatlng], opts);
        window.plugin.drawTools.drawnItems.addLayer(layer);
        window.plugin.drawTools.save();

    }

    // function to draw the plan to the plugin layer
    self.drawPlan = function(plan) {
        // initialize plugin layer
        self.clearLayers();

        $.each(plan, function(index,planStep) {
            if (planStep.action === 'link') {
                let ll_from = planStep.fromPortal.latLng, ll_to = planStep.portal.latLng;
                self.drawLink(ll_from, ll_to, self.linkStyle);
            }
            if (planStep.action === 'field') {
                self.drawField(
                    planStep.a.latLng,
                    planStep.b.latLng,
                    planStep.c.latLng,
                    self.fieldStyle);
            }
        });
    }

    // function to export and draw the plan to the drawtools plugin layer
    self.exportToDrawtools = function(plan) {
        // initialize plugin layer
        if (window.plugin.drawTools !== 'undefined') {
            for (var i=0; i<self.plan.furthestPath.length-1; i++) {
                self.exportDrawtoolsLink(self.plan.furthestPath[i], self.plan.furthestPath[i+1]);
            }
        }
    }

    // function to add a link to the arc plugin
    self.drawArc = function (p1, p2) {
        if(typeof window.plugin.arcs != 'undefined') {
            window.selectedPortal = p1.id;
            window.plugin.arcs.draw();
            window.selectedPortal = p2.id;
            window.plugin.arcs.draw();
        }
    }


    // function to export the plan to the arc plugin
    self.drawArcPlan = function(plan) {
        // initialize plugin layer
        if(typeof window.plugin.arcs !== 'undefined') {
            $.each(plan, function(index, planStep) {
                if (planStep.action === 'link') {
                    self.drawArc(planStep.fromPortal, planStep.portal);
                }
            });
        }
    }

    self.buildDirection = function(compass1, compass2, angle) {
        if (angle == 0) return compass1;
        if (angle == 45) return compass1 + compass2;
        if (angle > 45) return self.buildDirection(compass2, compass1, 90-angle);
        return compass1 + ' ' + angle + '° ' + compass2;
    }

    self.formatBearing = function(bearing) {
        var bearingFromNorth = false;
        bearing = (bearing + 360) % 360;
        if (bearingFromNorth)
            return bearing.toString().padStart(3, '0') + "°";
        if (bearing <= 90) return self.buildDirection('N', 'E', bearing);
        else if (bearing <= 180) return self.buildDirection('S', 'E', 180-bearing);
        else if (bearing <= 270) return self.buildDirection('S', 'W', bearing-180);
        else return self.buildDirection('N', 'W', 360-bearing);
    }

    self.formatDistance = function(distanceMeters) {
        const feetInAMeter = 3.28084;
        const milesInAMeter = 0.000621371;
        const kmInAMeter = 0.001;

        if (distanceMeters < 1000) {
            const distanceFeet = Math.round(distanceMeters * feetInAMeter);
            return `${Math.round(distanceMeters)}m (${distanceFeet}ft)`;
        } else {
            const distanceKm = (distanceMeters * kmInAMeter).toFixed(2);
            const distanceMiles = (distanceMeters * milesInAMeter).toFixed(2);
            return `${distanceKm}km (${distanceMiles}mi)`;
        }
    }

    self.info_dialog_html = '<div id="more-info-container" '+
    '                    style="height: inherit; display: flex; flex-direction: column; align-items: stretch;">\n' +
    '   <div style="display: flex;justify-content: space-between;align-items: center;">\n' +
    '      <span>This is '+pluginName+' version '+version+'. Follow the links below if you would like to:\n' +
    '        <ul>\n'+
    '           <li>Info coming soon!</li>\n' +
//    '          <li style="visibility:hidden;"> <a href="https://www.youtube.com/watch?v=LGCOUXZDEjU" target="_blank">Learn how to use this plugin</a></li>\n'+
//    '          <li> <a href="https://www.youtube.com/playlist?list=PLQ2GCHa7ljyP9pl0fmz5Z8U8Rx3_VZMVl" target="_blank"">Watch some videos on Homogeneous Fields</a></li>\n'+
//    '          <li> <a href="https://youtu.be/yvvrHEtkxGc" target="_blank">Learn about the Cobweb fielding plan</a></li>\n'+
//    '          <li> <a href="https://www.youtube.com/playlist?list=PLQ2GCHa7ljyPucSuNPGagiBZVjFxkOMpC" target="_blank">See videos on maximising your fields</a></li>\n'+
//    '          <li> <a href="https://github.com/Heistergand/fanfields2/raw/master/iitc_plugin_fanfields2.user.js" target="_blank">Get a plugin for Fanfields</a></li>\n'+
//    '          <li> <a href="https://www.youtube.com/playlist?list=PLQ2GCHa7ljyMBxNRWm1rmH8_vp3GJvxzN" target="_blank">Find out more about Fanfields</a></li>\n'+
    '        </ul>\n' +
    '      Contributing authors:\n' +
    '        <ul>\n'+
//    '          <li> <a href="https://youtu.be/M1O2SehnPGw" target="_blank"">ChatGPT 4.0</a></li>\n'+
    '          <li> <a href="https://www.youtube.com/@57Cell" target="_blank">@57Cell</a></li>\n'+
    '        </ul>\n' +
    '      </span>\n' +
    '</div></div>';

    // ATTENTION! DO NOT EVER TOUCH THE STYLES WITHOUT INTENSE TESTING!
    self.dialog_html = '<div id="hcf-plan-container" ' +
        '                    style="height: inherit; display: flex; flex-direction: column; align-items: stretch;">\n' +
        '   <div style="display: flex;justify-content: space-between;align-items: center;">' +
        '      <span>Hello from your friendly drone flight planner!</span><br/>' +
        '      <span>Short Hop Color: <input type="color" id="short-hop-colorPicker" value="#cc44ff"></span>' +
        '      <span>Long Hop Color: <input type="color" id="long-hop-colorPicker" value="#ff0000"></span>' +
        '      <span>Full Tree Color: <input type="color" id="full-tree-colorPicker" value="#ffcc44"></span>' +
        '   </div>' +
        '    <fieldset style="margin: 2px;">\n'+
        '      <legend>Options</legend>\n'+
        '      <label for="path-type">Path optimisation: </label><br/>\n' +
        '      <input type="radio" id="path-min-hops" name="path-type" value="min-hops" />\n' +
        '      <label for="path-min-hops" title="Minimise the number of hops at any cost">Minimise Hops</label>\n' +
        '      <input type="radio" id="path-balanced" name="path-type" value="balanced" />\n' +
        '      <label for="path-balanced" title="A balance between minimising long hops or total number of hops">Balance Keys and Hops</label>\n' +
        '      <input type="radio" id="path-min-long-hops" name="path-type" value="min-long-hops" checked />\n' +
        '      <label for="path-min-long-hops" title="Avoid long hops if at all possible">Minimise Keys Needed</label><br/>\n' +
        '      <br/>\n' +
        '      <label for="optimisation-type">Optimisation Type: </label><br/>\n' +
        '      <input type="radio" id="opt-none" name="optimisation-type" value="none" checked />\n' +
        '      <label for="opt-none" title="No path optimisation. Recommended when you\'re still exploring which portals can be reached">None (fastest)</label>\n' +
        '      <input type="radio" id="opt-greedy" name="optimisation-type" value="greedy" />\n' +
        '      <label for="opt-greedy" title="Aims straight for the target portal. Might add more long links than it should.">Greedy</label>\n' +
        '      <input type="radio" id="opt-balanced" name="optimisation-type" value="balanced" />\n' +
        '      <label for="opt-balanced" title="Tries to quickly find a good path, but won\'t 100% always find the absolute best">Almost Perfect</label>\n' +
//        '      <input type="radio" id="opt-perfect" name="optimisation-type" value="perfect" />\n' +
//        '      <label for="opt-perfect" title="Slow and thorough, is guaranteed to find a path with minimum cost - if you\'re patient!">Perfect (slowest)</label>\n' +
        '      <div id="long-hop-length-container">\n' +
        '        <label for="long-hop-length">Long Hop Length: </label>\n' +
        '        <input type="number" id="long-hop-length" min="450" max="750" value="550" step="10">\n' +
        '      </div>\n' +
        '    </fieldset>\n' +
        '    <div id="hcf-buttons-container" style="margin: 3px;">\n' +
        '      <button id="scan-portals" style="cursor: pointer" style=""margin: 2px;">Use Portals In View</button>'+
        '      <button id="hcf-to-dt-btn" style="cursor: pointer">Export to DrawTools</button>'+
        '      <button id="swap-ends-btn" style="cursor: pointer">Switch End to Start</button>'+
        '      <button id="hcf-simulator-btn" style="cursor: pointer" hidden>Simulate</button>'+
        '      <button id="hcf-clear-start-btn" style="cursor: pointer">Clear Start Portal</button>'+
        '      <button id="hcf-clear-some-btn" style="cursor: pointer">Clear Unused Portals</button>'+
        '      <button id="hcf-clear-most-btn" style="cursor: pointer">Clear Most Portals</button>'+
        '      <button id="hcf-clear-btn" style="cursor: pointer">Clear All Portals</button>'+
        '      <button id="more-info" style="cursor: pointer" style="margin: 2px;">More Info</button>'+
        '    </div>\n' +
        '    <textarea readonly id="hcf-plan-text" style="height:inherit;min-height:150px;width: auto;margin:2px;resize:none"></textarea>\n'+
        '</div>\n';

    // Attach click event to find-hcf-plan-button after the dialog is created
    self.openDialog = function() {
        if (!self.dialogIsOpen()) {
            dialog({
                title: 'Drone Planning',
                id: 'hcf-plan-view',
                html: self.dialog_html,
                width: '40%',
                minHeight: 460,
            });
            self.attachEventHandler();
            $('#dialog-hcf-plan-view').css("height", "370px");
        }
    };

        // Attach click event to find-hcf-plan-button after the dialog is created
    self.open_info_dialog = function() {
        if (!self.infoDialogIsOpen()) {
            dialog({
                title: 'Plugin And Other Information',
                id: 'hcf-info-view',
                html: self.info_dialog_html,
                width: '30%',
                minHeight: 120,
            });
            self.attachEventHandler();
            $('#dialog-hcf-info-view').css("height", "220px");
        }
    };

    self.switchEndToStart = function() {
        if (!self.plan) return;
        if (!self.plan.furthestPath) return;
        self.startPortal = {guid: self.plan.furthestPath.slice(-1)[0]};
        self.updatePlan();
    }

    self.clearPortalsOffTrack = function(keepNeighbours) {
        var newAllPortals = {};
        var newGraph = {};

        // Convert furthestPath to a Set for efficient lookups
        let furthestPathSet = new Set(self.plan.furthestPath);
        // determine which portals should be retained
        for (let portalGUID in self.allPortals) {
            if (furthestPathSet.has(portalGUID)) {
                newAllPortals[portalGUID] = self.allPortals[portalGUID];
            }
        }

        // if keepNeighbours is true, also keep portals within 1.25km of furthestPath portals
        if (keepNeighbours) {
            for (let pathPortalGUID of furthestPathSet) {
                for (let portalGUID in self.allPortals) {
                    if (!newAllPortals[portalGUID]) {
                        let distance = self.getDistance(pathPortalGUID, portalGUID);
                        if (distance <= 1250) { // 1.25km = 1250m
                            newAllPortals[portalGUID] = self.allPortals[portalGUID];
                        }
                    }
                }
            }
        }

        // Then, construct the newGraph based on the portals retained in newAllPortals
        for (let portalGUID in newAllPortals) {
            // Initialize an entry in newGraph for the portal
            newGraph[portalGUID] = [];

            // Include connections to other portals that are also retained in newAllPortals
            if (self.graph[portalGUID]) {
                self.graph[portalGUID].forEach(neighborGUID => {
                    if (newAllPortals.hasOwnProperty(neighborGUID)) {
                        newGraph[portalGUID].push(neighborGUID);
                    }
                });
            }
        }

        // Update self.allPortals and self.graph with the filtered results
        self.allPortals = newAllPortals;
        self.graph = newGraph;
        self.updatePlan();
    };

    // Function to create and show the dialog
    self.showClearConfirmationDialog = function() {
        // Create dialog elements
        var dialog = document.createElement('div');
        dialog.id = 'clear-confirmation-dialog';
        dialog.style.cssText = `position: fixed;
        z-index: 1000;
        left: 0;
        top: 0;
        width: 100%;
        height: 100%;
        background-color: rgba(0,0,0,0.4);
        display: flex;
        justify-content: center;
        align-items: center;
    `;

        var content = document.createElement('div');
        content.style.cssText = `background-color: #fefefe;
        padding: 20px;
        border: 1px solid #888;
        max-width: 500px;
        text-align: center;
    `;

        var message = document.createElement('p');
        message.textContent = 'Are you sure you want to clear all portals from the cache? This action cannot be undone.';

        var yesButton = document.createElement('button');
        yesButton.textContent = 'Yes, I\'m sure!';
        yesButton.style.margin = '10px';

        var cancelButton = document.createElement('button');
        cancelButton.textContent = 'Cancel';
        cancelButton.style.margin = '10px';

        // Assemble the dialog
        content.appendChild(message);
        content.appendChild(yesButton);
        content.appendChild(cancelButton);
        dialog.appendChild(content);

        // Add the dialog to the body
        document.body.appendChild(dialog);

        // Set up event listeners
        yesButton.onclick = function() {
            self.clearLayers();
            self.startPortal = null;
            self.plan = null;
            self.allPortals = [];
            self.graph = {};
            $("#hcf-to-dt-btn").hide();
            document.body.removeChild(dialog);
            alert("All portals have been cleared from the cache.");
        };

        cancelButton.onclick = function() {
            document.body.removeChild(dialog);
        };
    }

    self.attachEventHandler = function() {
        $("#hcf-to-dt-btn").click(function() {
            self.exportToDrawtools(self.plan);
        });

        $("#swap-ends-btn").click(function() {
            self.switchEndToStart();
        });

        $("#short-hop-colorPicker").change(function() {
            self.drawLayer();
        });

        $("#long-hop-colorPicker").change(function() {
            self.drawLayer();
        });

        $("#full-tree-colorPicker").change(function() {
            self.drawLayer();
        });

        $("#hcf-clear-some-btn").click(function() {
            self.clearPortalsOffTrack(false);
        });

        $("#hcf-clear-most-btn").click(function() {
            self.clearPortalsOffTrack(true);
        });

        $("#hcf-clear-btn").click(function() {
            self.showClearConfirmationDialog();
//            self.clearLayers();
//            self.startPortal = null;
//            self.plan = null;
//            self.allPortals = [];
//            self.graph = {};
//            $("#hcf-to-dt-btn").hide();
        });

        $("#hcf-clear-start-btn").click(function() {
            self.clearLayers();
            self.startPortal = null;
            self.plan = null;
            $("#hcf-to-dt-btn").hide();
        });

        $("#scan-portals").click(function() {
            self.scanPortalsAndUpdateGraph();
        });

        $("#more-info").click(function() {
            self.open_info_dialog();
        });

        // Attach change event handlers to path optimization radio buttons
        $('input[name="path-type"]').change(function() {
            self.updatePlan();
        });

        // Attach change event handlers to optimization type radio buttons
        $('input[name="optimisation-type"]').change(function() {
            self.updatePlan();
        });


    } // end of attachEventHandler

    self.portalSelected = function(data) {
        // ignore if dialog closed
        if (!self.dialogIsOpen() || self.startPortal) {
            return;
        };

        // Ignore if already selected
        let portalDetails = window.portalDetail.get(data.selectedPortalGuid);
        if (portalDetails === undefined) return;
        self.startPortal = {guid: data.selectedPortalGuid, details: portalDetails};
        self.updatePlan();
    };

    self.dialogIsOpen = function() {
        return ($("#dialog-hcf-plan-view").hasClass("ui-dialog-content") && $("#dialog-hcf-plan-view").dialog('isOpen'));
    };

    self.infoDialogIsOpen = function() {
        return ($("#dialog-hcf-info-view").hasClass("ui-dialog-content") && $("#dialog-hcf-info-view").dialog('isOpen'));
    };

    self.getLatLng = function(guid) {
        let portal = self.allPortals[guid] ? self.allPortals[guid].options.data : null;
        if (portal) {
            let lat = parseFloat(portal.latE6 / 1e6);
            let lng = parseFloat(portal.lngE6 / 1e6);
            return new L.latLng(lat, lng); // Assuming L.latLng is available in your context
        }
        return null;
    };

    self.getDistance = function(guid1, guid2) {
        let latLng1 = self.getLatLng(guid1);
        let latLng2 = self.getLatLng(guid2);

        if (latLng1 && latLng2) {
            return self.distance(latLng1, latLng2);
        } else {
            return Infinity; // Or some error handling if one of the portals is not found
        }
    };

    self.distance = function(portal1, portal2) {
        return portal1.distanceTo(portal2);
    };

    // PLUGIN END
    self.pluginLoadedTimeStamp = performance.now();
    console.log('drone planner plugin is ready')


    // Add an info property for IITC's plugin system
    var setup = self.setup;
    setup.info = plugin_info;

    // export changelog
    if (typeof changelog !== 'undefined') setup.info.changelog = changelog;

    // Make sure window.bootPlugins exists and is an array
    if (!window.bootPlugins) window.bootPlugins = [];
    // Add our startup hook
    window.bootPlugins.push(setup);
    // If IITC has already booted, immediately run the 'setup' function
    if (window.iitcLoaded && typeof setup === 'function') setup();

} // wrapper end

// Create a script element to hold our content script
var script = document.createElement('script');
var info = {};

// GM_info is defined by the assorted monkey-themed browser extensions
// and holds information parsed from the script header.
if (typeof GM_info !== 'undefined' && GM_info && GM_info.script) {
    info.script = {
        version: GM_info.script.version,
        name: GM_info.script.name,
        description: GM_info.script.description
    };
}

// Create a text node and our IIFE inside of it
var textContent = document.createTextNode('('+ wrapper +')('+ JSON.stringify(info) +')');
// Add some content to the script element
script.appendChild(textContent);
// Finally, inject it... wherever.
(document.body || document.head || document.documentElement).appendChild(script);
