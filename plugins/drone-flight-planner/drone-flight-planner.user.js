// ==UserScript==
// @id             iitc-plugin-drone-planner@57Cell
// @name           IITC Plugin: 57Cell's Drone Flight Planner
// @version        1.0.5.20251208
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
// @grant          none
// ==/UserScript==

function wrapper(plugin_info) {
    if (typeof window.plugin !== 'function') window.plugin = function() {};
    plugin_info.buildName = '';
    plugin_info.dateTimeVersion = '2025-12-08-183000';
    plugin_info.pluginId = '57CellsDronePlanner';

    // PLUGIN START
    console.log('DronePlanner: Loading plugin...');
    let self = window.plugin.dronePlanner = function() {};

    // --- Config & State ---
    self.PLUGIN_VERSION = "1.0.5";
    
    self.linksLayerGroup = null;
    self.fieldsLayerGroup = null;
    self.highlightLayergroup = null;

    self.allPortals = {};
    self.graph = {};
    self.userBlockedNodes = new Set();
    
    // --- CSS ---
    self.setupCSS = function() {
        $("<style>").prop("type", "text/css").html(`
            #dp-dialog { display: flex; height: 100%; width: 100%; font-family: sans-serif; font-size: 12px; color: #ccc; background-color: #202020; overflow: hidden; }
            
            /* Main Layout */
            .dp-list-container { flex: 1; overflow: auto; border-right: 1px solid #444; background-color: #202020; position: relative; }
            .dp-controls { width: 230px; display: flex; flex-direction: column; gap: 8px; padding: 8px; background: #1b1b1b; overflow-y: auto; flex-shrink: 0; box-sizing: border-box; }

            /* Table Styles */
            .dp-table { width: 100%; border-collapse: collapse; min-width: 300px; }
            .dp-table th, .dp-table td { border: 1px solid #444; padding: 4px; white-space: nowrap; }
            .dp-table th { background-color: #1b3a4b; position: sticky; top: 0; z-index: 10; color: #fff; text-align: left; padding: 6px; }
            .dp-table tr:nth-child(even) { background-color: #262626; }
            .dp-table tr:hover { background-color: #333; }
            .dp-col-center { text-align: center !important; }
            .dp-col-right { text-align: right !important; }

            /* Button Styles */
            .dp-btn { background-color: #204020; border: 1px solid #3c6; color: #fff; padding: 6px; cursor: pointer; text-align: center; border-radius: 2px; user-select: none; font-weight: bold; }
            .dp-btn:hover { background-color: #306030; }
            .dp-btn.active { background-color: #3c6; color: #000; }
            .dp-btn-action { background-color: #1b3a4b; border: 1px solid #4da; color: #fff; }
            .dp-btn-action:hover { background-color: #2b4a5b; }
            .dp-btn-danger { background-color: #402020; border: 1px solid #f55; color: #fff; }
            .dp-btn-danger:hover { background-color: #603030; }
            .dp-btn-sm { padding: 2px 5px; font-size: 10px; }

            /* Control Groups */
            .dp-group { margin-bottom: 5px; border: 1px solid #444; padding: 6px; border-radius: 4px; background: #222; }
            .dp-group-title { font-weight: bold; color: #4da; margin-bottom: 6px; display: block; font-size: 11px; text-transform: uppercase; border-bottom: 1px solid #444; padding-bottom: 2px; }
            
            .dp-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; }
            .dp-row label { cursor: pointer; }
            .dp-input-sm { width: 50px; background: #333; border: 1px solid #555; color: #fff; padding: 2px; text-align: right; }
            .dp-color-input { height: 20px; width: 30px; border: none; padding: 0; background: none; cursor: pointer; }

            /* Text & Badges */
            .dp-fact { font-weight: bold; font-size: 10px; padding: 1px 3px; border-radius: 2px; }
            .fact-enl { color: #0f0; }
            .fact-res { color: #00f; }
            .fact-mac { color: #f00; }
            .fact-neu { color: #aaa; }
            
            .dp-step-dir { color: #4da; font-weight: bold; }
            .dp-step-name { font-weight: bold; color: #ddd; cursor: pointer; }
            .dp-step-name:hover { text-decoration: underline; color: #fff; }
            
            .dp-btn-alt { cursor: pointer; background: #333; border: 1px solid #666; color: #f55; border-radius: 3px; padding: 0 4px; font-size: 10px; }
            .dp-btn-alt:hover { background: #f55; color: #fff; border-color: #f00; }

            .dp-long-hop { border-left: 3px solid #f00; }
            .dp-short-hop { border-left: 3px solid #cc44ff; }

            /* Loading Overlay */
            .dp-loading { position: absolute; top:0; left:0; right:0; padding: 10px; background: rgba(255, 255, 170, 0.9); color: #000; text-align: center; font-weight: bold; z-index: 20; display: none;}
            
            /* Footer/Stats Area */
            .dp-stats-row { display: flex; justify-content: space-between; font-size: 11px; color: #aaa; margin-top: 4px; padding-top: 4px; border-top: 1px solid #333;}
            .dp-stat-val { color: #fff; font-weight: bold; }
        `).appendTo("head");
    };

    // --- GRAPH BUILDING ---
    self.scanPortalsAndUpdateGraph = function() {
        $(".dp-loading").text("Scanning...").show();
        setTimeout(() => { self.performScan(); }, 50);
    }

    self.performScan = function() {
        console.time("DronePlanner: GraphBuild");
        self.userBlockedNodes.clear();
        let graph = self.graph = {};
        let bounds = map.getBounds();
        let newPortals = {};
        
        for (let key in window.portals) {
            let portal = window.portals[key];
            if (bounds.contains(portal.getLatLng())) {
                newPortals[key] = portal;
                graph[key] = [];
            }
        }
        self.allPortals = newPortals;

        // Spatial Hashing (Bucketing)
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
                                }
                            }
                        });
                    }
                }
            }
        }
        console.timeEnd("DronePlanner: GraphBuild");
        self.updatePlan();
    }

    // --- PATHFINDING ---
    self.delayedUpdatePlan = function() {
        $(".dp-loading").text("Calculating Path...").show();
        setTimeout(() => { self.updatePlan(); }, 50);
    }

    self.updatePlan = function() {
        if (!self.startPortal) {
            self.renderPlanTable(null); // Show empty state
            $(".dp-loading").hide();
            return;
        }
        let graph = self.graph;

        // Routing Logic Switcher
        if (document.getElementById('opt-max-unique').checked) {
             console.time("DronePlanner: UniquePathCalc");
             let uniquePath = self.findMaxUniquePath(graph, self.startPortal.guid);
             self.plan = { furthestPath: uniquePath, tree: {} };
             console.timeEnd("DronePlanner: UniquePathCalc");
        } else if (document.getElementById('opt-farming').checked) {
             console.time("DronePlanner: FarmingCalc");
             let farmingPath = self.findFarmingPath(graph, self.startPortal.guid);
             self.plan = { furthestPath: farmingPath, tree: {} };
             console.timeEnd("DronePlanner: FarmingCalc");
        } else {
            console.time("DronePlanner: A*Calc");
            self.plan = self.findMinimumCostPath(graph);
            console.timeEnd("DronePlanner: A*Calc");
        }
        self.updateLayer();
    }

    // "Max Unique" Logic
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
        return path;
    }

    // "Max Portal Visits" (Farming) Logic
    self.findFarmingPath = function(graph, startNode) {
        let path = [startNode];
        let visited = new Set([startNode]);
        let current = startNode;
        let longHopThreshold = self.getLongHopThreshold();
        let maxSteps = 2000;

        for (let i = 0; i < maxSteps; i++) {
            if (!graph[current]) break;
            let neighbors = graph[current].filter(n => !visited.has(n) && !self.userBlockedNodes.has(n));
            if (neighbors.length === 0) break;

            // Nearest Neighbor Greedy
            neighbors.sort((a, b) => {
                let distA = self.getDistance(current, a);
                let distB = self.getDistance(current, b);
                return distA - distB;
            });

            let nextNode = null;
            for (let candidate of neighbors) {
                let dist = self.getDistance(current, candidate);
                if (dist > longHopThreshold && !self.areLongHopsAllowed()) continue;
                nextNode = candidate;
                break;
            }

            if (!nextNode) break;
            visited.add(nextNode);
            path.push(nextNode);
            current = nextNode;
        }
        return path;
    }

    self.findMinimumCostPath = function(graph) {
        let pnfp = self.createSpanningTreeAndFindFurthestPortal(graph);
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
        let val = parseInt($('#dp-hop-length').val());
        if (isNaN(val) || val < 0) return 500;
        return val;
    }

    self.getCostFromHops = function(longHops, shortHops) {
        let pathType = $('input[name="dp-path-type"]:checked').val();
        let penalty = 3;
        if (pathType === 'min-long-hops') penalty = 100;
        if (pathType === 'min-hops') penalty = 1.01;
        return shortHops + (longHops * penalty);
    };

    self.areLongHopsAllowed = function() {
        return $('input[name="dp-allow-long"]:checked').val() == "yes";
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
        let t = p.options.team; 
        if (t === 1) return { code: "RES", class: "fact-res" };
        if (t === 2) return { code: "ENL", class: "fact-enl" };
        if (t === 3 || t === 'M') return { code: "MAC", class: "fact-mac" };
        return { code: "---", class: "fact-neu" };
    }
    
    self.blockAndReroute = function(guid) {
        self.userBlockedNodes.add(guid);
        self.delayedUpdatePlan();
    }

    self.copyPlanToClipboard = function() {
        if (!self.plan || !self.plan.furthestPath) {
            alert("No flight plan to copy.");
            return;
        }
        let text = "";
        
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
            alert("Failed to copy to clipboard.");
        });
    }

    // --- UI RENDERING ---
    self.renderPlanTable = function(path) {
        let container = $("#dp-plan-body");
        if (!path) {
            container.html('<tr><td colspan="6" style="text-align:center; padding:20px; color:#888;">Scan area and set Start to begin.</td></tr>');
            $("#dp-stats").html("");
            return;
        }

        let longHopThreshold = self.getLongHopThreshold();
        let html = "";
        
        let totalDistance = self.getDistance(path[0], path[path.length-1]) / 1000;
        let hopCount = path.length - 1;
        
        $("#dp-stats").html(`<div class="dp-stats-row"><span class="dp-stat-val">${totalDistance.toFixed(2)} km</span> total distance &nbsp;|&nbsp; <span class="dp-stat-val">${hopCount}</span> hops</div>`);

        for (let i = 0; i < path.length; i++) {
            let guid = path[i];
            let name = self.getPortalNameFromGUID(guid);
            let factInfo = self.getFactionCode(guid);
            
            let distance = i == 0 ? 0 : self.getDistance(path[i], path[i-1]);
            let isLong = distance > longHopThreshold;
            let rowClass = isLong ? "dp-long-hop" : "dp-short-hop";
            
            let dir = i > 0 ? self.getCardinalDirection(path[i-1], guid) : "-";
            let altBtn = i > 0 ? `<div class="dp-btn-alt" title="Block & Reroute" data-guid="${guid}">♻ Alt</div>` : '';
            
            html += `<tr class="${rowClass}">
                        <td class="dp-col-center">${i}</td>
                        <td class="dp-col-center dp-step-dir">${dir}</td>
                        <td class="dp-col-center"><span class="dp-fact ${factInfo.class}">${factInfo.code}</span></td>
                        <td><span class="dp-step-name" data-guid="${guid}" title="${name}">${name}</span></td>
                        <td class="dp-col-right">${Math.round(distance)}m</td>
                        <td class="dp-col-center">${altBtn}</td>
                     </tr>`;
        }
        container.html(html);
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
            self.renderPlanTable(self.plan.furthestPath);
            self.drawLayer();
        } else {
            self.renderPlanTable(null);
        }
        $(".dp-loading").hide();
    };

    self.drawLayer = function() {
        self.clearLayers();
        let shortHopColor = $('#dp-color-short').val();
        let longHopColor = $('#dp-color-long').val();
        let fullTreeColor = $('#dp-color-tree').val();
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
    };

    self.resetAll = function() {
        self.clearLayers();
        self.startPortal = null;
        self.plan = null;
        self.allPortals = {};
        self.graph = {};
        self.userBlockedNodes.clear();
        self.renderPlanTable(null);
    }

    self.setup = function() {
        self.setupCSS();
        
        self.linksLayerGroup = new L.LayerGroup();
        window.addLayerGroup('Drone Paths (Tree)', self.linksLayerGroup, false);

        self.fieldsLayerGroup = new L.LayerGroup();
        window.addLayerGroup('Drone Flight Path', self.fieldsLayerGroup, true);
        
        self.highlightLayergroup = new L.LayerGroup();
        window.addLayerGroup('Drone Highlights', self.highlightLayergroup, true);

        $('#toolbox').append('<a onclick="window.plugin.dronePlanner.openDialog(); return false;">Plan Drone Flight</a>');
        
        window.addHook('portalSelected', self.portalSelected);
        window.map.on('overlayadd overlayremove', function() {
            setTimeout(function(){ self.updateLayer(); },1);
        });
    };

    self.clearLayers = function() {
        if (self.linksLayerGroup) self.linksLayerGroup.clearLayers();
        if (self.fieldsLayerGroup) self.fieldsLayerGroup.clearLayers();
        if (self.highlightLayergroup) self.highlightLayergroup.clearLayers();
    }

    self.drawLine = function(layerGroup, alatlng, blatlng, style) {
        if (window.map.hasLayer(layerGroup)) {
            L.polyline([alatlng, blatlng], style).addTo(layerGroup);
        }
    }

    self.portalSelected = function(data) {
        if (!self.dialogIsOpen()) return;
        if (self.startPortal) return; 

        // Fix: Use data from scanner instead of detailed view
        let guid = data.selectedPortalGuid;
        let p = self.allPortals[guid];

        if (!p) {
             let iitcPortal = window.portals[guid];
             if (iitcPortal) {
                 p = {
                     guid: guid,
                     name: iitcPortal.options.data.title || "Untitled",
                     lat: iitcPortal.getLatLng().lat,
                     lng: iitcPortal.getLatLng().lng,
                     options: iitcPortal.options.data
                 };
                 // Add to cache so we can route
                 self.allPortals[guid] = p;
                 if(!self.graph[guid]) self.graph[guid] = []; 
             }
        }

        if (!p) return;

        self.startPortal = { guid: guid, details: p };
        self.delayedUpdatePlan();
    };

    // --- HTML TEMPLATE ---
    self.dialog_html = `
        <div id="dp-dialog">
            <div class="dp-loading">Loading...</div>
            <div class="dp-list-container">
                <table class="dp-table">
                    <thead>
                        <tr>
                            <th style="width:30px">#</th>
                            <th style="width:30px">Dir</th>
                            <th style="width:30px">Fac</th>
                            <th>Portal Name</th>
                            <th class="dp-col-right" style="width:60px">Dist</th>
                            <th class="dp-col-center" style="width:40px">Act</th>
                        </tr>
                    </thead>
                    <tbody id="dp-plan-body"></tbody>
                </table>
            </div>
            
            <div class="dp-controls">
                <div class="dp-group">
                    <span class="dp-group-title">Action & Status</span>
                    <div class="dp-btn dp-btn-action" id="dp-btn-scan">Scan Area Portals</div>
                    <div id="dp-stats"></div>
                </div>

                <div class="dp-group">
                    <span class="dp-group-title">Start Point</span>
                    <div style="display:flex; gap:2px">
                        <div class="dp-btn" style="flex:1" id="dp-btn-set-start">Set Start</div>
                        <div class="dp-btn dp-btn-danger" style="flex:1" id="dp-btn-clear-start">Clear</div>
                    </div>
                </div>

                <div class="dp-group">
                    <span class="dp-group-title">Strategy</span>
                    <div class="dp-row"><label><input type="radio" name="dp-strategy" id="opt-distance" value="distance" checked> Max Distance</label></div>
                    <div class="dp-row"><label><input type="radio" name="dp-strategy" id="opt-max-unique" value="max-unique"> Max Unique Portals</label></div>
                    <div class="dp-row"><label><input type="radio" name="dp-strategy" id="opt-farming" value="farming"> Max Portal Visits</label></div>
                </div>

                <div class="dp-group">
                    <span class="dp-group-title">Constraints</span>
                    <div class="dp-row">
                        <label>Path Logic:</label>
                        <select id="dp-path-type" style="background:#333; color:#fff; border:1px solid #555; width:90px;">
                            <option value="min-long-hops">Min Keys</option>
                            <option value="min-hops">Min Hops</option>
                            <option value="balanced">Balanced</option>
                        </select>
                    </div>
                    <div class="dp-row">
                        <label>Allow Long Hops:</label>
                        <div>
                            <label><input type="radio" name="dp-allow-long" value="yes"> Yes</label>
                            <label><input type="radio" name="dp-allow-long" value="no" checked> No</label>
                        </div>
                    </div>
                    <div class="dp-row">
                        <label>Hop Limit (m):</label>
                        <input type="number" id="dp-hop-length" class="dp-input-sm" value="500" step="10" min="50" max="2000">
                    </div>
                </div>

                <div class="dp-group">
                    <span class="dp-group-title">Appearance</span>
                    <div class="dp-row">
                        <label>Short Hop:</label>
                        <input type="color" id="dp-color-short" class="dp-color-input" value="#cc44ff" title="Safe jumps (No key)">
                    </div>
                    <div class="dp-row">
                        <label>Long Hop:</label>
                        <input type="color" id="dp-color-long" class="dp-color-input" value="#ff0000" title="Key required">
                    </div>
                    <div class="dp-row">
                        <label>Tree:</label>
                        <input type="color" id="dp-color-tree" class="dp-color-input" value="#ffcc44" title="All reachable nodes">
                    </div>
                </div>

                <div class="dp-group">
                    <span class="dp-group-title">Export / Manage</span>
                    <div class="dp-btn dp-btn-action dp-btn-sm" id="dp-btn-drawtools" style="margin-bottom:4px">Save to DrawTools</div>
                    <div class="dp-btn dp-btn-action dp-btn-sm" id="dp-btn-copy" style="margin-bottom:4px">Copy Steps</div>
                    <div class="dp-btn dp-btn-danger dp-btn-sm" id="dp-btn-reset">Full Reset</div>
                </div>
            </div>
        </div>
    `;

    self.openDialog = function() {
        if (!self.dialogIsOpen()) {
            self.resetAll();
            dialog({
                title: `Drone Flight Planner v${self.PLUGIN_VERSION}`,
                id: 'dp-plugin-dialog',
                html: self.dialog_html,
                width: 700,
                height: 500,
                minHeight: 400,
                minWidth: 500
            });
            self.attachEventHandlers();
        }
    };

    self.attachEventHandlers = function() {
        $('#dp-btn-scan').click(() => self.scanPortalsAndUpdateGraph());
        $('#dp-btn-set-start').click(() => {
            self.startPortal = null; 
            self.renderPlanTable(null);
            $(".dp-loading").text("Click a portal on the map to set Start").show();
        });
        $('#dp-btn-clear-start').click(() => { self.startPortal = null; self.updatePlan(); });
        $('#dp-btn-reset').click(() => { if(confirm("Reset everything?")) self.resetAll(); });
        $('#dp-btn-copy').click(() => self.copyPlanToClipboard());
        $('#dp-btn-drawtools').click(() => self.exportToDrawtools(self.plan));

        // Config Changes
        $('input[name="dp-strategy"]').change(() => self.delayedUpdatePlan());
        $('#dp-path-type').change(() => self.delayedUpdatePlan());
        $('input[name="dp-allow-long"]').change(() => self.delayedUpdatePlan());
        $('#dp-hop-length').on('change input', () => self.delayedUpdatePlan());
        
        // Colors
        $('#dp-color-short, #dp-color-long, #dp-color-tree').change(() => self.drawLayer());

        // Dynamic Table Clicks
        $('#dp-plan-body').on('click', '.dp-step-name', function() {
            let guid = $(this).data('guid');
            self.panToPortal(guid);
        });
        $('#dp-plan-body').on('click', '.dp-btn-alt', function() {
            let guid = $(this).data('guid');
            self.blockAndReroute(guid);
        });
    };

    self.dialogIsOpen = function() {
        return ($("#dialog-dp-plugin-dialog").length > 0);
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

    // --- Export Drawtools ---
    self.exportToDrawtools = function(plan) {
        if (!window.plugin.drawTools) return;
        if (!plan || !plan.furthestPath) return;
        
        let path = plan.furthestPath;
        let shortColor = $('#dp-color-short').val();
        let longColor = $('#dp-color-long').val();
        let threshold = self.getLongHopThreshold();

        for (var i=0; i<path.length-1; i++) {
            let p1 = self.getLatLng(path[i]);
            let p2 = self.getLatLng(path[i+1]);
            let dist = self.distance(p1, p2);
            let color = dist > threshold ? longColor : shortColor;
            
            let opts = {...window.plugin.drawTools.lineOptions};
            opts.color = color;
            
            let layer = L.geodesicPolyline([p1, p2], opts);
            window.plugin.drawTools.drawnItems.addLayer(layer);
        }
        window.plugin.drawTools.save();
        alert("Path saved to DrawTools.");
    }

    if (window.iitcLoaded && typeof self.setup === 'function') self.setup();
    else if (window.bootPlugins) window.bootPlugins.push(self.setup);
    else window.bootPlugins = [self.setup];
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
