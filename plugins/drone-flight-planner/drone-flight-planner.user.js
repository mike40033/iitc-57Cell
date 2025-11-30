// ==UserScript==
// @id             iitc-plugin-drone-planner@57Cell
// @name           IITC Plugin: 57Cell's Drone Flight Planner
// @version        1.0.2.20251130
// @description    Plugin for planning drone flights in IITC
// @author         57Cell (Michael Hartley) and ChatGPT 4.0, updates by kyke31 (Enrique H.) with Gemini
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
version = "1.0.2";
changeLog = [
    {
        version: '1.0.2.20251130',
        changes: [
            'MAJOR: Complete UI overhaul (compact 2-col, interactive list)',
            'PERF: Spatial Hashing for O(N) graph building',
            'NEW: "Max Unique" mode (for Unique Drone Visited stat)',
            'NEW: Copy flight plan to clipboard, cardinal directions, faction colors',
            'UX: Start point selection flow, blocked nodes rerouting',
        ],
    },
    {
        version: '1.0.1.20250909',
        changes: [
            'NEW: Allow users to disallow the key trick',
        ],
    },
];

function wrapper(plugin_info) {
    if (typeof window.plugin !== 'function') window.plugin = function() {};
    plugin_info.buildName = '';
    plugin_info.dateTimeVersion = '2025-11-30-120000';
    plugin_info.pluginId = '57CellsDronePlanner';

    // PLUGIN START
    console.log('DronePlanner: Loading plugin...');
    var changelog = changeLog;
    let self = window.plugin.dronePlanner = function() {};

    // --- CSS STYLES ---
    const styles = `
        .drone-plan-list {
            list-style-type: none;
            padding: 0;
            margin: 0;
            font-family: monospace;
        }
        .drone-plan-step {
            display: grid;
            grid-template-columns: 25px 30px 35px 1fr 50px 35px; /* # Dir Fac Name Dist Alt */
            align-items: center;
            padding: 2px 4px;
            border-bottom: 1px solid #eee;
            font-size: 11px;
            color: #333;
            gap: 5px;
        }
        .drone-plan-step:hover {
            background-color: #e0f7fa;
        }
        .drone-step-info {
            cursor: pointer;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            font-weight: bold;
        }
        .drone-step-dir { color: #007bb5; font-weight: bold; }
        
        .drone-fact { font-weight: bold; font-size: 10px; }
        .fact-enl { color: #008800; }
        .fact-res { color: #0000aa; }
        .fact-mac { color: #aa0000; }
        .fact-neu { color: #666666; }

        .drone-step-alt {
            cursor: pointer;
            padding: 1px 4px;
            background: #f0f0f0;
            border: 1px solid #ccc;
            border-radius: 3px;
            font-size: 9px;
            color: #d32f2f;
            text-align: center;
        }
        .drone-step-alt:hover {
            background: #d32f2f;
            color: white;
        }
        .drone-plan-step.long-hop { border-left: 3px solid #ff0000; }
        .drone-plan-step.short-hop { border-left: 3px solid #cc44ff; }
        
        /* Compact Button Layout */
        .hcf-row-container {
            display: flex;
            align-items: center;
            margin-bottom: 4px;
        }
        .hcf-row-label {
            width: 50px;
            font-size: 10px;
            font-weight: bold;
            color: #666;
            text-align: right;
            padding-right: 8px;
        }
        .hcf-btn-group {
            display: flex;
            flex: 1;
            gap: 2px;
        }
        .hcf-btn-group button {
            flex: 1;
            padding: 2px 5px;
            font-size: 10px;
            cursor: pointer;
        }
        .hcf-loading {
            padding: 10px;
            color: #000;
            background: #ffffaa;
            text-align: center;
            font-weight: bold;
            font-size: 11px;
        }
        .hcf-plan-header {
            font-size: 11px;
            font-weight: bold;
            padding: 4px;
            background: #f4f4f4;
            border-bottom: 1px solid #ccc;
            color: #333;
        }
    `;

    // --- STATE VARIABLES ---
    self.linksLayerGroup = null;
    self.fieldsLayerGroup = null;
    self.highlightLayergroup = null;

    self.allPortals = {};
    self.graph = {};
    self.userBlockedNodes = new Set();

    // --- GRAPH BUILDING ---
    self.scanPortalsAndUpdateGraph = function() {
        console.log("DronePlanner: Starting scan...");
        $("#hcf-plan-list-container").html("<div class='hcf-loading'>Scanning...</div>");
        setTimeout(() => { self.performScan(); }, 50);
    }

    self.performScan = function() {
        console.time("DronePlanner: GraphBuild");
        self.userBlockedNodes.clear();
        let graph = self.graph = {};
        let bounds = map.getBounds();
        let newPortals = {};
        let edgeCount = 0;
        
        // Filter visible portals
        for (let key in window.portals) {
            let portal = window.portals[key];
            if (bounds.contains(portal.getLatLng())) {
                newPortals[key] = portal;
                graph[key] = [];
            }
        }
        self.allPortals = newPortals;
        console.log(`DronePlanner: Found ${Object.keys(newPortals).length} visible portals.`);

        // Spatial Hashing (Bucketing) to optimize graph build
        let BUCKET_SIZE = 0.02; 
        let buckets = {};
        function getBucketId(lat, lng) {
            return Math.floor(lat / BUCKET_SIZE) + "_" + Math.floor(lng / BUCKET_SIZE);
        }

        for (let key in newPortals) {
            let ll = newPortals[key].getLatLng();
            let bid = getBucketId(ll.lat, ll.lng);
            if (!buckets[bid]) buckets[bid] = [];
            buckets[bid].push(key);
        }

        let maxDist = self.getHardMaxDistance();
        
        // Build Edges
        for (let key in newPortals) {
            let ll = newPortals[key].getLatLng();
            let bx = Math.floor(ll.lat / BUCKET_SIZE);
            let by = Math.floor(ll.lng / BUCKET_SIZE);

            for (let x = bx - 1; x <= bx + 1; x++) {
                for (let y = by - 1; y <= by + 1; y++) {
                    let neighborBid = `${x}_${y}`;
                    if (buckets[neighborBid]) {
                        buckets[neighborBid].forEach(otherKey => {
                            if (key < otherKey) { 
                                let distance = self.getDistance(key, otherKey);
                                if (distance <= maxDist) {
                                    graph[key].push(otherKey);
                                    graph[otherKey].push(key);
                                    edgeCount++;
                                }
                            }
                        });
                    }
                }
            }
        }
        console.log(`DronePlanner: Built graph with ${edgeCount} connections.`);
        console.timeEnd("DronePlanner: GraphBuild");
        self.updatePlan();
    }

    // --- PATHFINDING LOGIC ---
    self.delayedUpdatePlan = function() {
        $("#hcf-plan-list-container").html("<div class='hcf-loading'>Calculating...</div>");
        setTimeout(() => { self.updatePlan(); }, 50);
    }

    self.updatePlan = function() {
        if (!self.startPortal) {
            console.log("DronePlanner: No start portal selected.");
            $("#hcf-plan-list-container").html("<div style='padding:5px; color:#333; font-size:11px;'>1. Click 'Scan Area'<br>2. Click 'Start (Set)'<br>3. Click a portal on map</div>");
            return;
        }
        let graph = self.graph;

        if (document.getElementById('opt-max-unique').checked) {
             console.time("DronePlanner: UniquePathCalc");
             let uniquePath = self.findMaxUniquePath(graph, self.startPortal.guid);
             self.plan = { furthestPath: uniquePath, tree: {} };
             console.timeEnd("DronePlanner: UniquePathCalc");
        } else {
            console.time("DronePlanner: A*Calc");
            self.plan = self.findMinimumCostPath(graph);
            console.timeEnd("DronePlanner: A*Calc");
        }
        self.updateLayer();
    }

    self.findMaxUniquePath = function(graph, startNode) {
        let path = [startNode];
        let visited = new Set([startNode]);
        let current = startNode;
        let longHopThreshold = self.getLongHopThreshold();
        let maxSteps = 200; 

        for (let i = 0; i < maxSteps; i++) {
            if (!graph[current]) break;
            let neighbors = graph[current].filter(n => !visited.has(n) && !self.userBlockedNodes.has(n));
            if (neighbors.length === 0) break;

            neighbors.sort((a, b) => {
                let distA = self.getDistance(current, a);
                let distB = self.getDistance(current, b);
                let isShortA = distA <= longHopThreshold;
                let isShortB = distB <= longHopThreshold;
                if (isShortA && !isShortB) return -1;
                if (!isShortA && isShortB) return 1;
                
                let countA = (graph[a] || []).filter(n => !visited.has(n) && !self.userBlockedNodes.has(n)).length;
                let countB = (graph[b] || []).filter(n => !visited.has(n) && !self.userBlockedNodes.has(n)).length;
                return countB - countA;
            });

            let nextNode = neighbors[0];
            let dist = self.getDistance(current, nextNode);
            if (dist > longHopThreshold && !self.areLongHopsAllowed()) {
                 let validNode = neighbors.find(n => self.getDistance(current, n) <= longHopThreshold);
                 if (validNode) nextNode = validNode;
                 else break;
            }
            visited.add(nextNode);
            path.push(nextNode);
            current = nextNode;
        }
        console.log(`DronePlanner: Max unique path found with ${path.length} steps.`);
        return path;
    }

    self.findMinimumCostPath = function(graph) {
        console.time("DronePlanner: SpanningTree");
        let pnfp = self.createSpanningTreeAndFindFurthestPortal(graph);
        console.timeEnd("DronePlanner: SpanningTree");
        
        let tree = self.constructTree(pnfp.pn);
        tree.furthestPath = self.applyAStar(graph, self.startPortal.guid, pnfp.fp, self.heuristic);
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
                    if (!visited.has(neighbor) && !self.userBlockedNodes.has(neighbor)) {
                        let distance = self.getDistance(current, neighbor);
                        let isShortHop = distance <= longHopThreshold;
                        if (!isShortHop && !self.areLongHopsAllowed()) return;
                        visited.add(neighbor);
                        previousNodes[neighbor] = current;
                        if (isShortHop) queue.unshift(neighbor);
                        else queue.push(neighbor);
                    }
                });
            }
        }
        return {pn: previousNodes, fp:furthestPortal};
    };

    self.heuristic = function (node, goal) {
        let distMetres = self.getDistance(node, goal);
        let longHopThreshold = self.getLongHopThreshold();
        let shortHopCost = Math.ceil(distMetres / longHopThreshold);
        let numLongHops = Math.floor(distMetres / self.getHardMaxDistance());
        let numShortHops = 0;
        if (distMetres - self.getHardMaxDistance()*numLongHops > longHopThreshold) numLongHops++;
        else numShortHops++;
        
        let longHopCost = Infinity;
        if (self.areLongHopsAllowed()) longHopCost = self.getCostFromHops(numLongHops,numShortHops);
        return Math.min(longHopCost, shortHopCost);
    }

    self.applyAStar = function(graph, start, end, heuristic) {
        let openSet = [start];
        let cameFrom = {};
        let gScore = { [start]: 0 };
        let fScore = { [start]: heuristic(start, end) };
        let longHopThreshold = self.getLongHopThreshold();

        while (openSet.length > 0) {
            openSet.sort((a, b) => fScore[a] - fScore[b]);
            let current = openSet.shift();
            if (current === end) return self.reconstructPath(cameFrom, current);

            if (graph[current]) {
                graph[current].forEach(neighbor => {
                    if (self.userBlockedNodes.has(neighbor)) return;
                    let distance = self.getDistance(current, neighbor);
                    let isLongHop = distance > longHopThreshold;
                    if (isLongHop && !self.areLongHopsAllowed()) return;
                    let cost = isLongHop ? self.getCostFromHops(1, 0) : self.getCostFromHops(0, 1);
                    let tentative_gScore = gScore[current] + cost;
                    if (!gScore.hasOwnProperty(neighbor) || tentative_gScore < gScore[neighbor]) {
                        cameFrom[neighbor] = current;
                        gScore[neighbor] = tentative_gScore;
                        let tentative_fScore = gScore[neighbor] + heuristic(neighbor, end);
                        if (!fScore.hasOwnProperty(neighbor)) {
                            fScore[neighbor] = tentative_fScore;
                            openSet.push(neighbor);
                        } else if (tentative_fScore < fScore[neighbor]) fScore[neighbor] = tentative_fScore;
                    }
                });
            }
        }
        console.warn("DronePlanner: A* failed to find a path.");
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

    // --- UTILITIES ---

    self.getLongHopThreshold = function() {
        let val = parseInt(document.getElementById('long-hop-length').value);
        if (isNaN(val) || val < 0) return 500;
        return val;
    }

    self.getCostFromHops = function(longHops, shortHops) {
        let pathType = document.querySelector('input[name="path-type"]:checked').value;
        let penalty = 3;
        if (pathType === 'min-long-hops') penalty = 100;
        if (pathType === 'min-hops') penalty = 1.01;
        return shortHops + (longHops * penalty);
    };

    self.areLongHopsAllowed = function() {
        return document.querySelector('input[name="allow-long-hops"]:checked').value == "yes-long-hops";
    }

    self.getHardMaxDistance = function() { return 1250; }

    self.constructTree = function(previousNodes) {
        let tree = {};
        for (let key in previousNodes) {
            tree[key] = { parent: previousNodes[key] };
        }
        return tree;
    };

    self.getCardinalDirection = function(guidFrom, guidTo) {
        if (!guidFrom || !guidTo) return "";
        let ll1 = self.getLatLng(guidFrom);
        let ll2 = self.getLatLng(guidTo);
        if (!ll1 || !ll2) return "";
        
        let y = Math.sin(ll2.lng * Math.PI / 180 - ll1.lng * Math.PI / 180) * Math.cos(ll2.lat * Math.PI / 180);
        let x = Math.cos(ll1.lat * Math.PI / 180) * Math.sin(ll2.lat * Math.PI / 180) -
                Math.sin(ll1.lat * Math.PI / 180) * Math.cos(ll2.lat * Math.PI / 180) * Math.cos(ll2.lng * Math.PI / 180 - ll1.lng * Math.PI / 180);
        let bearing = Math.atan2(y, x) * 180 / Math.PI;
        bearing = (bearing + 360) % 360;

        const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW', 'N'];
        return directions[Math.round(bearing / 45)];
    }

    self.getFactionCode = function(guid) {
        let p = self.allPortals[guid];
        if (!p || !p.options) return { code: "---", class: "fact-neu" };
        let t = p.options.team; // 1=RES, 2=ENL, 3=MAC
        if (t === 1) return { code: "RES", class: "fact-res" };
        if (t === 2) return { code: "ENL", class: "fact-enl" };
        if (t === 3 || t === 'M') return { code: "MAC", class: "fact-mac" };
        return { code: "---", class: "fact-neu" };
    }
    
    self.blockAndReroute = function(guid) {
        console.log("DronePlanner: Blocking portal " + guid + " and rerouting.");
        self.userBlockedNodes.add(guid);
        self.delayedUpdatePlan();
    }

    self.copyPlanToClipboard = function() {
        if (!self.plan || !self.plan.furthestPath) {
            alert("No flight plan to copy.");
            return;
        }
        let text = "";
        let longHopThreshold = self.getLongHopThreshold();

        for (let i = 0; i < self.plan.furthestPath.length; i++) {
            let guid = self.plan.furthestPath[i];
            let name = self.getPortalNameFromGUID(guid);
            let faction = self.getFactionCode(guid).code;
            let dir = "";
            let distance = 0;
            
            if (i > 0) {
                let prevGuid = self.plan.furthestPath[i-1];
                dir = self.getCardinalDirection(prevGuid, guid);
                distance = self.getDistance(prevGuid, guid);
            }
            
            text += `${i}. [${dir}] [${faction}] ${name} (${Math.round(distance)}m)\n`;
        }

        navigator.clipboard.writeText(text).then(function() {
            alert("Flight plan copied to clipboard!");
        }, function(err) {
            console.error('Could not copy text: ', err);
            alert("Failed to copy to clipboard.");
        });
    }

    // --- UI RENDERING ---
    self.renderPlanAsList = function() {
        if (!self.plan || !self.plan.furthestPath) return "";
        let longHopThreshold = self.getLongHopThreshold();
        let html = '<ul class="drone-plan-list">';
        
        let totalDistance = self.getDistance(self.plan.furthestPath[0], self.plan.furthestPath.slice(-1)[0]) / 1000;
        let hopCount = self.plan.furthestPath.length - 1;
        
        html += `<div class="hcf-plan-header">
                   Total: ${totalDistance.toFixed(2)}km | ${hopCount} Hops
                 </div>`;

        for (let i = 0; i < self.plan.furthestPath.length; i++) {
            let guid = self.plan.furthestPath[i];
            let name = self.getPortalNameFromGUID(guid);
            let factInfo = self.getFactionCode(guid);
            
            let distance = i == 0 ? 0 : self.getDistance(self.plan.furthestPath[i], self.plan.furthestPath[i-1]);
            let isLong = distance > longHopThreshold;
            let hopClass = isLong ? "long-hop" : "short-hop";
            
            let dir = i > 0 ? self.getCardinalDirection(self.plan.furthestPath[i-1], guid) : "-";
            let altBtn = i > 0 ? `<div class="drone-step-alt" title="Reroute" data-guid="${guid}">&#9851;</div>` : '';
            
            html += `<li class="drone-plan-step ${hopClass}">
                        <div style="text-align:right; font-weight:bold;">${i}.</div>
                        <div class="drone-step-dir">${dir}</div>
                        <div class="drone-fact ${factInfo.class}">${factInfo.code}</div>
                        <div class="drone-step-info" data-guid="${guid}" title="${name}">${name}</div>
                        <div style="text-align:right;">${Math.round(distance)}m</div>
                        <div>${altBtn}</div>
                     </li>`;
        }
        html += '</ul>';
        return html;
    }

    self.panToPortal = function(guid) {
        let latLng = self.getLatLng(guid);
        if(latLng) window.map.panTo(latLng);
    }

    self.getPortalNameFromGUID = function(guid) {
        let portalData = self.allPortals[guid];
        if (portalData && portalData.options && portalData.options.data && portalData.options.data.title) {
            return portalData.options.data.title;
        }
        return "Unknown";
    };

    self.updateLayer = function() {
        if (self.plan && self.plan.furthestPath) {
            let html = self.renderPlanAsList();
            $("#hcf-plan-list-container").html(html);
            self.drawLayer();
        } else {
            $("#hcf-plan-list-container").html("<div style='padding:5px; color:#333; font-size:11px;'>1. Click 'Scan Area'<br>2. Click 'Start (Set)'<br>3. Click a portal on map</div>");
        }
    };

    self.drawLayer = function() {
        console.time("DronePlanner: DrawLayer");
        self.clearLayers();
        let shortHopColor = document.getElementById('short-hop-colorPicker').value;
        let longHopColor = document.getElementById('long-hop-colorPicker').value;
        let fullTreeColor = document.getElementById('full-tree-colorPicker').value;
        let longHopThreshold = self.getLongHopThreshold();

        function getStyle(distance, isTree) {
            return {
                color: isTree ? fullTreeColor : distance > longHopThreshold ? longHopColor : shortHopColor,
                opacity: 1,
                weight: isTree ? 1.5 : 4.5,
                clickable: false,
                interactive: false,
                dashArray: [12, 5, 4, 5, 6, 5, 8, 5, "100000"],
            };
        }

        // Draw Tree
        for (let guid in self.plan) {
            if (self.plan[guid] && self.plan[guid].parent) {
                let startLatLng = self.getLatLng(guid);
                let endLatLng = self.getLatLng(self.plan[guid].parent);
                let distance = self.getDistance(guid, self.plan[guid].parent);
                self.drawLine(self.linksLayerGroup, startLatLng, endLatLng, getStyle(distance, true));
            }
        }
        // Draw Path
        for (let i = 0; i < self.plan.furthestPath.length - 1; i++) {
            let startLatLng = self.getLatLng(self.plan.furthestPath[i]);
            let endLatLng = self.getLatLng(self.plan.furthestPath[i + 1]);
            let distance = self.getDistance(self.plan.furthestPath[i], self.plan.furthestPath[i + 1]);
            self.drawLine(self.fieldsLayerGroup, startLatLng, endLatLng, getStyle(distance, false));
        }
        console.timeEnd("DronePlanner: DrawLayer");
    };

    self.resetAll = function() {
        console.log("DronePlanner: Resetting state.");
        self.clearLayers();
        self.startPortal = null;
        self.plan = null;
        self.allPortals = {};
        self.graph = {};
        self.userBlockedNodes.clear();
        $("#hcf-plan-list-container").html("<div style='padding:5px; color:#333; font-size:11px;'>1. Click 'Scan Area'<br>2. Click 'Start (Set)'<br>3. Click a portal on map</div>");
    }

    self.setup = function() {
        $("<style>").prop("type", "text/css").html(styles).appendTo("head");

        $('#toolbox').append('<a onclick="window.plugin.dronePlanner.openDialog(); return false;">Plan Drone Flight</a>');
        window.addHook('portalSelected', self.portalSelected);

        self.linksLayerGroup = new L.LayerGroup();
        window.addLayerGroup('All Drone Paths', self.linksLayerGroup, false);

        self.fieldsLayerGroup = new L.LayerGroup();
        window.addLayerGroup('Longest Drone Path', self.fieldsLayerGroup, false);
        
        self.highlightLayergroup = new L.LayerGroup();
        window.addLayerGroup('Start Portal Highlights', self.highlightLayergroup, true);

        window.map.on('overlayadd overlayremove', function() {
            setTimeout(function(){ self.updateLayer(); },1);
        });
    };

    self.clearLayers = function() {
        if (window.map.hasLayer(self.linksLayerGroup)) self.linksLayerGroup.clearLayers();
        if (window.map.hasLayer(self.fieldsLayerGroup)) self.fieldsLayerGroup.clearLayers();
        if (window.map.hasLayer(self.highlightLayergroup)) self.highlightLayergroup.clearLayers();
    }

    self.drawLine = function(layerGroup, alatlng, blatlng, style) {
        if (!window.map.hasLayer(layerGroup)) return;
        var poly = L.polyline([alatlng, blatlng], style);
        poly.addTo(layerGroup);
    }

    self.exportDrawtoolsLink = function(p1, p2) {
        let alatlng = self.getLatLng(p1);
        let blatlng = self.getLatLng(p2);
        let distance = self.distance(alatlng, blatlng);
        let opts = {...window.plugin.drawTools.lineOptions};
        let shortHopColor = document.getElementById('short-hop-colorPicker').value;
        let longHopColor = document.getElementById('long-hop-colorPicker').value;
        let longHopThreshold = self.getLongHopThreshold();
        opts.color =distance > longHopThreshold ? longHopColor : shortHopColor;
        let layer = L.geodesicPolyline([alatlng, blatlng], opts);
        window.plugin.drawTools.drawnItems.addLayer(layer);
        window.plugin.drawTools.save();
    }

    self.exportToDrawtools = function(plan) {
        if (window.plugin.drawTools !== 'undefined') {
            for (var i=0; i<self.plan.furthestPath.length-1; i++) {
                self.exportDrawtoolsLink(self.plan.furthestPath[i], self.plan.furthestPath[i+1]);
            }
        }
    }

    self.info_dialog_html = '<div id="more-info-container" style="height: inherit; display: flex; flex-direction: column; align-items: stretch;">' +
    '   <div style="display: flex;justify-content: space-between;align-items: center;">' +
    '      <span>This is '+pluginName+' version '+version+'.</span>' +
    '</div></div>';

    // UPDATED COMPACT DIALOG HTML
    self.dialog_html = '<div id="hcf-plan-container" style="height: inherit; display: flex; flex-direction: column; align-items: stretch; font-size:11px;">\n' +
        '   <div style="display: flex;justify-content: space-between;align-items: center; margin-bottom:5px;">' +
        '      <span>Plan setup:</span>' +
        '      <span title="Color for safe jumps (under limit)">Short: <input type="color" id="short-hop-colorPicker" value="#cc44ff" style="height:15px; width:20px;"></span>' +
        '      <span title="Color for long jumps (over limit, requires keys)">Long: <input type="color" id="long-hop-colorPicker" value="#ff0000" style="height:15px; width:20px;"></span>' +
        '      <span title="Color for all reachable portals explored">Tree: <input type="color" id="full-tree-colorPicker" value="#ffcc44" style="height:15px; width:20px;"></span>' +
        '   </div>' +
        '    <fieldset style="margin: 0 0 5px 0; padding: 2px;">\n'+
        '      <legend>Options</legend>\n'+
        '      <div style="display: flex; flex-wrap: wrap;">\n' +
        // Column 1
        '        <div style="width: 50%; box-sizing: border-box; padding-right: 5px;">\n' +
        '          <input type="radio" id="path-min-hops" name="path-type" value="min-hops" title="Find path with fewest moves" /><label for="path-min-hops" title="Find path with fewest moves">Min Hops</label><br/>\n' +
        '          <input type="radio" id="path-balanced" name="path-type" value="balanced" title="Balance between distance and key usage" /><label for="path-balanced" title="Balance between distance and key usage">Balanced</label><br/>\n' +
        '          <input type="radio" id="path-min-long-hops" name="path-type" value="min-long-hops" checked title="Avoid long hops requiring keys" /><label for="path-min-long-hops" title="Avoid long hops requiring keys">Min Keys</label>\n' +
        '          <hr style="border: 0; border-top: 1px solid #ccc; margin: 2px 0;">\n' + 
        '          <strong title="Enable/Disable hops over 500m (requires keys)">Long Hops: </strong>\n' +
        '          <input type="radio" id="path-yes-long-hops" name="allow-long-hops" value="yes-long-hops" title="Enable/Disable hops over 500m (requires keys)" /><label for="path-yes-long-hops">Yes</label>\n' +
        '          <input type="radio" id="path-no-long-hops" name="allow-long-hops" value="no-long-hops" checked title="Enable/Disable hops over 500m (requires keys)" /><label for="path-no-long-hops">No</label>\n' +
        '        </div>\n' +
        // Column 2
        '        <div style="width: 50%; box-sizing: border-box; padding-left: 5px; border-left: 1px solid #ccc;">\n' +
        '          <strong title="Optimization Goal">Strategy:</strong><br/>\n' +
        '          <input type="radio" id="opt-distance" name="optimisation-type" value="distance" checked title="Optimization Goal" /><label for="opt-distance">Max distance</label><br/>\n' +
        '          <input type="radio" id="opt-max-unique" name="optimisation-type" value="max-unique" title="Optimization Goal" /><label for="opt-max-unique">Max unique portals</label>\n' +
        '          <hr style="border: 0; border-top: 1px solid #ccc; margin: 2px 0;">\n' + 
        '          <label for="long-hop-length">Short/long hop limit: </label>\n' +
        '          <input type="number" id="long-hop-length" min="450" max="750" value="500" step="10" style="width: 45px;">meters\n' +
        '        </div>\n' +
        '      </div>\n' + 
        '    </fieldset>\n' +
        
        // Buttons
        '    <div class="hcf-row-container">' +
        '       <div class="hcf-row-label">Actions:</div>' +
        '       <div class="hcf-btn-group">' +
        '         <button id="scan-portals">Scan Area</button>'+
        '         <button id="hcf-set-start-btn">Start (Set)</button>'+
        '         <button id="hcf-clear-start-btn">Start (Clear)</button>'+
        '       </div>' +
        '    </div>' +
        '    <div class="hcf-row-container">' +
        '       <div class="hcf-row-label">Manage:</div>' +
        '       <div class="hcf-btn-group">' +
        '         <button id="hcf-clear-some-btn">Trim Unused</button>'+
        '         <button id="hcf-reset-btn">Reset</button>'+
        '         <button id="more-info">Info</button>'+
        '       </div>' +
        '    </div>' +
        '    <div class="hcf-row-container">' +
        '       <div class="hcf-row-label">Export:</div>' +
        '       <div class="hcf-btn-group">' +
        '         <button id="hcf-to-dt-btn">DrawTools</button>'+
        '         <button id="hcf-copy-btn">Copy Steps</button>'+
        '       </div>' +
        '    </div>' +
        
        // List Container
        '    <div id="hcf-plan-list-container" style="flex:1; width: auto; margin:2px; border:1px solid #ccc; overflow-y:auto; background:#fff;">' +
        '       <div style="padding:10px; color:#333;">1. Click Scan<br>2. Click \'Start (Set)\'</div>' +
        '    </div>\n'+
        '</div>\n';

    self.openDialog = function() {
        if (!self.dialogIsOpen()) {
            // Auto-reset state when opening for a fresh start
            self.resetAll();

            dialog({
                title: 'Plan Drone Flight',
                id: 'hcf-plan-view',
                html: self.dialog_html,
                width: '640px',
                minHeight: 380,
            });
            self.attachEventHandler();
            $('#dialog-hcf-plan-view').css("height", "370px");
        }
    };

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

    self.showResetConfirmationDialog = function() {
        if(confirm("Reset everything?")) {
            self.resetAll();
            $("#hcf-plan-list-container").html("<div style='padding:5px; color:#333;'>Reset complete.</div>");
        }
    }

    self.attachEventHandler = function() {
        $("#hcf-to-dt-btn").click(function() { self.exportToDrawtools(self.plan); });
        $("#hcf-copy-btn").click(function() { self.copyPlanToClipboard(); });
        $("#short-hop-colorPicker, #long-hop-colorPicker, #full-tree-colorPicker").change(function() { self.drawLayer(); });
        $("#long-hop-length").on('change input', function() { self.delayedUpdatePlan(); });
        $("#hcf-clear-some-btn").click(function() { self.clearPortalsOffTrack(false); });
        $("#hcf-reset-btn").click(function() { self.showResetConfirmationDialog(); });
        
        $("#hcf-clear-start-btn").click(function() {
            self.clearLayers();
            self.startPortal = null;
            self.plan = null;
            $("#hcf-plan-list-container").html("<div style='padding:5px; color:#333;'>Start cleared.</div>");
        });

        $("#hcf-set-start-btn").click(function() {
            self.startPortal = null;
            $("#hcf-plan-list-container").html("<div style='padding:5px; color:#000; background:#ffffaa;'><b>Waiting...</b><br>Click a portal on the map</div>");
        });

        $("#scan-portals").click(function() { self.scanPortalsAndUpdateGraph(); });
        $("#more-info").click(function() { self.open_info_dialog(); });

        $('input[name="path-type"], input[name="allow-long-hops"], input[name="optimisation-type"]').change(function() {
            self.delayedUpdatePlan();
        });
        
        $('#hcf-plan-list-container').on('click', '.drone-step-info', function() {
            let guid = $(this).data('guid');
            self.panToPortal(guid);
        });

        $('#hcf-plan-list-container').on('click', '.drone-step-alt', function() {
            let guid = $(this).data('guid');
            self.blockAndReroute(guid);
        });
    } 

    self.portalSelected = function(data) {
        if (!self.dialogIsOpen()) return;
        if (self.startPortal) return;
        let portalDetails = window.portalDetail.get(data.selectedPortalGuid);
        if (portalDetails === undefined) return;
        self.startPortal = {guid: data.selectedPortalGuid, details: portalDetails};
        self.delayedUpdatePlan();
    };

    self.dialogIsOpen = function() {
        return ($("#dialog-hcf-plan-view").hasClass("ui-dialog-content") && $("#dialog-hcf-plan-view").dialog('isOpen'));
    };
    self.infoDialogIsOpen = function() {
        return ($("#dialog-hcf-info-view").hasClass("ui-dialog-content") && $("#dialog-hcf-info-view").dialog('isOpen'));
    };
    self.getLatLng = function(guid) {
        let portal = self.allPortals[guid] ? self.allPortals[guid].options.data : null;
        if (portal) return new L.latLng(parseFloat(portal.latE6 / 1e6), parseFloat(portal.lngE6 / 1e6));
        return null;
    };
    self.getDistance = function(guid1, guid2) {
        let latLng1 = self.getLatLng(guid1);
        let latLng2 = self.getLatLng(guid2);
        if (latLng1 && latLng2) return self.distance(latLng1, latLng2);
        else return Infinity;
    };
    self.distance = function(portal1, portal2) {
        return portal1.distanceTo(portal2);
    };

    // PLUGIN END
    self.pluginLoadedTimeStamp = performance.now();
    console.log('drone planner plugin is ready')
    var setup = self.setup;
    setup.info = plugin_info;
    if (typeof changelog !== 'undefined') setup.info.changelog = changelog;
    if (!window.bootPlugins) window.bootPlugins = [];
    window.bootPlugins.push(setup);
    if (window.iitcLoaded && typeof setup === 'function') setup();
} 

var script = document.createElement('script');
var info = {};
if (typeof GM_info !== 'undefined' && GM_info && GM_info.script) {
    info.script = {
        version: GM_info.script.version,
        name: GM_info.script.name,
        description: GM_info.script.description
    };
}
var textContent = document.createTextNode('('+ wrapper +')('+ JSON.stringify(info) +')');
script.appendChild(textContent);
(document.body || document.head || document.documentElement).appendChild(script);
