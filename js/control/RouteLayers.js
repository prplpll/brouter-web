/**
 * Route layers: keeps several routes and tracks in the same view, similar to the multi-route planner
 * of Ride with GPS. The route currently edited with BRouter is the "active route", all other routes
 * are layers that can be shown/hidden, colored, reordered, exported, split and activated for editing.
 */
BR.RouteLayers = L.Evented.extend({
    storageId: 'route-layers',

    options: {
        colors: [
            '#e6194b',
            '#3cb44b',
            '#4363d8',
            '#f58231',
            '#911eb4',
            '#2bb5d1',
            '#f032e6',
            '#9a6324',
            '#800000',
            '#469990',
        ],
        weight: 4,
        // max. number of waypoints when converting an imported track to an editable route
        maxConvertedWaypoints: 100,
    },

    /**
     * @param {L.Map} map
     * @param {Object} deps `routing`, `elevation` (BR.Heightgraph), `onActiveRouteChanged` callback
     */
    initialize(map, deps, options) {
        L.setOptions(this, options);
        this._map = map;
        this._routing = deps.routing;
        this._elevation = deps.elevation;
        this._onActiveRouteChanged = deps.onActiveRouteChanged || function () {};

        this._layers = [];
        this._nextId = 1;
        this._activeName = '';
        this._profileSource = 'route';
        this._selection = null;
        this._routeData = null;

        map.createPane('routeLayers');
        // above loaded tracks (350), below route (overlay pane, 400)
        map.getPane('routeLayers').style.zIndex = 360;
        this._group = L.layerGroup().addTo(map);

        this._initDom();
        this._load();
        this._render();

        map.on('heightgraph:selection', this._onSelection, this);
    },

    /**
     * Called on every route update with the route polyline and BRouter segments
     */
    update(track, segments) {
        this._routeData = segments.length > 0 ? this._dataFromRoute(track, segments) : null;
        // route update redraws the elevation chart with the route
        this._profileSource = 'route';
        this._render();
    },

    // --- data ---

    _dataFromRoute(track, segments) {
        const points = [];
        const times = [];
        let timeOffset = 0;

        for (const segment of segments) {
            const latLngs = segment.getLatLngs();
            const segmentTimes = segment.feature.properties.times;
            for (let i = 0; i < latLngs.length; i++) {
                const ll = latLngs[i];
                points.push(ll.alt !== undefined ? [ll.lat, ll.lng, ll.alt] : [ll.lat, ll.lng]);
                times.push(segmentTimes && segmentTimes[i] !== undefined ? timeOffset + +segmentTimes[i] : null);
            }
            timeOffset += +segment.feature.properties['total-time'] || 0;
        }

        return {
            lines: [points],
            times: times.indexOf(null) === -1 ? [times] : null,
            waypoints: this._routing.getWaypoints().map((ll) => [ll.lat, ll.lng]),
            beelineFlags: this._routing.getBeelineFlags(),
            brouterStats: BR.RouteLayerStats.fromSegments(segments),
            source: 'route',
        };
    },

    _addLayer(data, index = 0) {
        const layer = Object.assign(
            {
                id: this._nextId++,
                name: '',
                color: this._nextColor(),
                visible: true,
                times: null,
                waypoints: null,
                beelineFlags: null,
                brouterStats: null,
            },
            data
        );
        layer.stats = BR.RouteLayerStats.calc(layer.lines, layer.times);
        this._layers.splice(index, 0, layer);
        this._createMapLayer(layer);
        this._changed();
        return layer;
    },

    _removeLayer(layer) {
        const idx = this._layers.indexOf(layer);
        if (idx === -1) return;
        this._layers.splice(idx, 1);
        this._group.removeLayer(layer.mapLayer);
        if (this._profileSource === layer.id) {
            this._showRouteProfile();
        }
        this._changed();
    },

    _getLayer(id) {
        return this._layers.find((layer) => layer.id === id);
    },

    _nextColor() {
        const used = this._layers.map((layer) => layer.color);
        const colors = this.options.colors;
        return colors.find((color) => used.indexOf(color) === -1) || colors[this._layers.length % colors.length];
    },

    _changed() {
        this._updateMapOrder();
        this._save();
        this._render();
    },

    // --- map ---

    _createMapLayer(layer) {
        const latLngs = layer.lines.map((line) => line.map((p) => L.latLng(p)));
        const casing = L.polyline(latLngs, {
            pane: 'routeLayers',
            interactive: false,
            color: 'white',
            opacity: 0.8,
            weight: this.options.weight + 3,
        });
        const line = L.polyline(latLngs, {
            pane: 'routeLayers',
            interactive: false,
            color: layer.color,
            opacity: 0.9,
            weight: this.options.weight,
        });
        layer.mapLayer = L.featureGroup([casing, line]);
        layer.line = line;
        if (layer.visible) {
            this._group.addLayer(layer.mapLayer);
        }
    },

    _updateMapOrder() {
        // list is ordered top to bottom, bring to front from the bottom up
        for (let i = this._layers.length - 1; i >= 0; i--) {
            const layer = this._layers[i];
            if (this._group.hasLayer(layer.mapLayer)) {
                layer.mapLayer.bringToFront();
            }
        }
    },

    _setVisible(layer, visible) {
        layer.visible = visible;
        if (visible) {
            this._group.addLayer(layer.mapLayer);
        } else {
            this._group.removeLayer(layer.mapLayer);
        }
        this._changed();
    },

    _setColor(layer, color) {
        layer.color = color;
        layer.line.setStyle({ color });
        this._save();
        this._renderList();
    },

    _highlight(layer, on) {
        if (!layer || !layer.visible) return;
        layer.line.setStyle({ weight: on ? this.options.weight + 3 : this.options.weight });
        if (on) {
            layer.mapLayer.bringToFront();
        } else {
            this._updateMapOrder();
        }
    },

    _zoomTo(layer) {
        this._map.fitBounds(layer.line.getBounds());
    },

    // --- elevation profile and selection ---

    _showProfile(layer) {
        const latLngs = [].concat(...layer.lines).map((p) => L.latLng(p));
        this._elevation.update(L.polyline(latLngs));
        this._profileSource = layer.id;
        $('#elevation-chart').collapse('show');
        this._render();
    },

    _showRouteProfile() {
        const track = this._routing.toPolyline();
        this._elevation.update(track, this._routing._segments);
        this._profileSource = 'route';
        this._render();
    },

    _onSelection(evt) {
        this._selection = evt.selection;
        this._renderToolbar();
    },

    _profileSourceData() {
        if (this._profileSource === 'route') {
            return this._routeData ? Object.assign({ name: this._activeRouteName() }, this._routeData) : null;
        }
        return this._getLayer(this._profileSource);
    },

    /**
     * Copies the section selected in the elevation chart into a new layer
     */
    saveSelection() {
        const source = this._profileSourceData();
        if (!source || !this._selection) return;

        const section = BR.RouteLayers.extractSection(source, this._selection.start, this._selection.end);
        if (!section) return;

        const km = L.Util.formatNum(BR.RouteLayerStats.calc(section.lines).trackLength / 1000, 1);
        section.name = i18next.t('sidebar.route-layers.section-name', {
            name: source.name,
            distance: km.toLocaleString(),
            defaultValue: '{{name}} (section, {{distance}} km)',
        });
        section.source = 'section';
        this._addLayer(section);
    },

    // --- active route ---

    _activeRouteName() {
        if (this._activeName) return this._activeName;
        // first unused default name
        const names = this._layers.map((layer) => layer.name);
        for (let number = 1; ; number++) {
            const name = i18next.t('sidebar.route-layers.route-name', { number, defaultValue: 'Route {{number}}' });
            if (names.indexOf(name) === -1) return name;
        }
    },

    _routeAsLayerData() {
        if (!this._routeData) return null;
        return Object.assign({ name: this._activeRouteName() }, this._routeData);
    },

    /**
     * Keeps the current route as layer and starts a new, empty route
     */
    newRoute() {
        const data = this._routeAsLayerData();
        if (data) {
            this._addLayer(data);
        }
        this._activeName = '';
        this._routing.clear();
        this._routeData = null;
        this._onActiveRouteChanged();
        this._routing.draw(true);
        this._render();
    },

    /**
     * Adds a copy of the current route as layer, keeps editing the current route
     */
    duplicateRoute() {
        const data = this._routeAsLayerData();
        if (!data) return;
        data.name = i18next.t('sidebar.route-layers.copy-name', {
            name: data.name,
            defaultValue: '{{name}} (copy)',
        });
        this._addLayer(data);
    },

    /**
     * Makes a layer the active (editable) route, the current route becomes a layer at its place
     */
    activate(layer) {
        const index = this._layers.indexOf(layer);
        let waypoints = layer.waypoints;
        if (!waypoints) {
            waypoints = BR.RouteLayers.simplifyToWaypoints(layer.lines, this.options.maxConvertedWaypoints);
        }
        if (!waypoints || waypoints.length < 2) return;

        const current = this._routeAsLayerData();
        this._removeLayer(layer);
        if (current) {
            this._addLayer(current, index);
        }

        this._activeName = layer.name;
        this._routing.clear();
        this._routeData = null;
        this._routing.setWaypoints(
            waypoints.map((p) => L.latLng(p)),
            layer.beelineFlags,
            (err) => {
                if (err) {
                    BR.message.showError(err);
                }
            }
        );
        this._onActiveRouteChanged();
        this._render();
    },

    // --- import / export ---

    importFiles(files) {
        Array.from(files).forEach((file) => {
            const reader = new FileReader();
            reader.onload = () => {
                try {
                    const data = BR.RouteLayers.parseFile(file.name, reader.result);
                    if (!data) {
                        throw new Error(i18next.t('sidebar.route-layers.no-lines', 'No lines found'));
                    }
                    const layer = this._addLayer(data);
                    this._zoomTo(layer);
                } catch (err) {
                    BR.message.showError(
                        i18next.t('warning.tracks-load-error', {
                            error: file.name + ': ' + (err && err.message ? err.message : err),
                        })
                    );
                    console.error(err);
                }
            };
            reader.readAsText(file);
        });
    },

    exportGpx(layer) {
        const geoJson = BR.RouteLayers.toGeoJson(layer);
        const gpx = togpx(geoJson, {
            creator: BR.conf.appName || 'BRouter-Web',
            metadata: { name: layer.name },
        });
        const blob = new Blob([gpx], { type: 'application/gpx+xml;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = (layer.name || 'route').replace(/[\\/:*?"<>|]+/g, '_') + '.gpx';
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    },

    // --- persistence ---

    _save() {
        if (!BR.Util.localStorageAvailable()) return;
        const keys = ['id', 'name', 'color', 'visible', 'lines', 'times', 'waypoints', 'beelineFlags'];
        const data = this._layers.map((layer) => {
            const item = {};
            keys.forEach((key) => (item[key] = layer[key]));
            item.brouterStats = layer.brouterStats;
            item.source = layer.source;
            return item;
        });
        try {
            localStorage.setItem(this.storageId, JSON.stringify({ layers: data }));
        } catch (err) {
            if (!this._saveWarningShown) {
                this._saveWarningShown = true;
                BR.message.showError(i18next.t('sidebar.route-layers.save-error', 'Route layers too large to keep'));
            }
            console.warn(err);
        }
    },

    _load() {
        if (!BR.Util.localStorageAvailable()) return;
        try {
            const stored = JSON.parse(localStorage.getItem(this.storageId) || 'null');
            if (!stored || !Array.isArray(stored.layers)) return;
            for (const item of stored.layers) {
                this._nextId = Math.max(this._nextId, (item.id || 0) + 1);
                this._addLayer(item, this._layers.length);
            }
        } catch (err) {
            console.warn('Failed to restore route layers', err);
        }
    },

    // --- DOM ---

    _initDom() {
        this._$pane = $('#tab_route_layers');
        this._$toolbar = $('#route-layers-toolbar');
        this._$active = $('#route-layers-active');
        this._$list = $('#route-layers-list');
        const self = this;

        const fileInput = document.getElementById('route-layers-file');
        fileInput.addEventListener('change', function () {
            self.importFiles(this.files);
            this.value = '';
        });

        this._$pane.on('click', '[data-action]', function (e) {
            e.preventDefault();
            const action = $(this).data('action');
            const id = $(this).closest('[data-layer-id]').data('layer-id');
            self._onAction(action, id !== undefined ? self._getLayer(id) : null);
        });

        this._$list.on('change', 'input.route-layer-visible', function () {
            const layer = self._getLayer($(this).closest('[data-layer-id]').data('layer-id'));
            self._setVisible(layer, this.checked);
        });
        this._$list.on('input change', 'input.route-layer-color', function (e) {
            const layer = self._getLayer($(this).closest('[data-layer-id]').data('layer-id'));
            if (e.type === 'input') {
                // live preview while picking
                layer.line.setStyle({ color: this.value });
            } else {
                self._setColor(layer, this.value);
            }
        });
        this._$list.on('dblclick', '.route-layer-name', function () {
            self._onAction('rename', self._getLayer($(this).closest('[data-layer-id]').data('layer-id')));
        });
        this._$active.on('dblclick', '.route-layer-name', function () {
            self._onAction('rename-active');
        });
        this._$list.on('mouseenter mouseleave', '.route-layer', function (e) {
            self._highlight(self._getLayer($(this).data('layer-id')), e.type === 'mouseenter');
        });

        // reorder by drag & drop
        this._$list.on('dragstart', '.route-layer', function (e) {
            self._dragId = $(this).data('layer-id');
            e.originalEvent.dataTransfer.effectAllowed = 'move';
            e.originalEvent.dataTransfer.setData('text/plain', String(self._dragId));
        });
        this._$list.on('dragover', '.route-layer', function (e) {
            if (self._dragId === undefined) return;
            e.preventDefault();
            const rect = this.getBoundingClientRect();
            const after = e.originalEvent.clientY > rect.top + rect.height / 2;
            $(this).toggleClass('drop-before', !after).toggleClass('drop-after', after);
        });
        this._$list.on('dragleave', '.route-layer', function () {
            $(this).removeClass('drop-before drop-after');
        });
        this._$list.on('drop', '.route-layer', function (e) {
            if (self._dragId === undefined) return;
            e.preventDefault();
            const after = $(this).hasClass('drop-after');
            self._move(self._getLayer(self._dragId), self._getLayer($(this).data('layer-id')), after);
        });
        this._$list.on('dragend', '.route-layer', function () {
            self._dragId = undefined;
            self._$list.find('.route-layer').removeClass('drop-before drop-after');
        });

        // import by dropping files onto the panel
        this._$pane.on('dragover', function (e) {
            const types = e.originalEvent.dataTransfer && e.originalEvent.dataTransfer.types;
            if (self._dragId === undefined && types && Array.from(types).indexOf('Files') !== -1) {
                e.preventDefault();
                self._$pane.addClass('route-layers-dropzone');
            }
        });
        this._$pane.on('dragleave drop', function (e) {
            self._$pane.removeClass('route-layers-dropzone');
            if (e.type === 'drop' && self._dragId === undefined && e.originalEvent.dataTransfer.files.length) {
                e.preventDefault();
                self.importFiles(e.originalEvent.dataTransfer.files);
            }
        });
    },

    _move(layer, target, after) {
        if (!layer || !target || layer === target) return;
        this._layers.splice(this._layers.indexOf(layer), 1);
        let idx = this._layers.indexOf(target);
        if (after) idx++;
        this._layers.splice(idx, 0, layer);
        this._changed();
    },

    _onAction(action, layer) {
        switch (action) {
            case 'import':
                document.getElementById('route-layers-file').click();
                break;
            case 'new':
                this.newRoute();
                break;
            case 'duplicate':
                this.duplicateRoute();
                break;
            case 'save-selection':
                this.saveSelection();
                break;
            case 'show-all':
            case 'hide-all':
                this._layers.forEach((l) => {
                    l.visible = action === 'show-all';
                    this._group[l.visible ? 'addLayer' : 'removeLayer'](l.mapLayer);
                });
                this._changed();
                break;
            case 'delete-all':
                if (!this._layers.length) return;
                bootbox.confirm(i18next.t('sidebar.route-layers.delete-all-confirm', 'Delete all layers?'), (ok) => {
                    if (ok) {
                        this._layers.slice().forEach((l) => this._removeLayer(l));
                    }
                });
                break;
            case 'route-profile':
                this._showRouteProfile();
                $('#elevation-chart').collapse('show');
                break;
            case 'rename-active':
                bootbox.prompt({
                    title: i18next.t('sidebar.route-layers.rename', 'Rename'),
                    value: this._activeRouteName(),
                    callback: (name) => {
                        if (name !== null) {
                            this._activeName = name.trim();
                            this._renderActive();
                        }
                    },
                });
                break;
            case 'rename':
                bootbox.prompt({
                    title: i18next.t('sidebar.route-layers.rename', 'Rename'),
                    value: layer.name,
                    callback: (name) => {
                        if (name !== null && name.trim()) {
                            layer.name = name.trim();
                            this._save();
                            this._renderList();
                        }
                    },
                });
                break;
            case 'zoom':
                this._zoomTo(layer);
                break;
            case 'profile':
                this._showProfile(layer);
                break;
            case 'activate':
                this.activate(layer);
                break;
            case 'export':
                this.exportGpx(layer);
                break;
            case 'delete':
                this._removeLayer(layer);
                break;
        }
    },

    _render() {
        this._renderToolbar();
        this._renderActive();
        this._renderList();
    },

    _renderToolbar() {
        const hasRoute = !!this._routeData;
        const source = this._profileSourceData();
        this._$toolbar.find('[data-action=duplicate]').prop('disabled', !hasRoute);
        this._$toolbar.find('[data-action=save-selection]').prop('disabled', !(this._selection && source));
        this._$pane.find('.route-layers-bulk [data-action]').prop('disabled', this._layers.length === 0);
    },

    _renderActive() {
        const $active = this._$active.empty();
        const $item = $('<div class="route-layer route-layer-active">');
        const $head = $('<div class="route-layer-head">').appendTo($item);
        $('<span class="badge badge-pill route-layer-badge">')
            .text(i18next.t('sidebar.route-layers.active-route', 'Active'))
            .appendTo($head);
        $('<span class="route-layer-name">')
            .text(this._activeRouteName())
            .attr('title', i18next.t('sidebar.route-layers.rename-hint', 'Double-click to rename'))
            .appendTo($head);
        const $actions = $('<span class="route-layer-actions">').appendTo($head);
        if (this._routeData) {
            this._actionButton('route-profile', 'fa-area-chart', 'sidebar.route-layers.profile', 'Elevation profile')
                .toggleClass('active', this._profileSource === 'route')
                .appendTo($actions);
            $item.append(this._statsHtml(this._routeData.brouterStats, this._routeStats()));
        } else {
            $('<div class="route-layer-empty text-muted">')
                .text(i18next.t('sidebar.route-layers.no-route', 'No route drawn yet.'))
                .appendTo($item);
        }
        $active.append($item);
    },

    _routeStats() {
        if (!this._routeStatsCache || this._routeStatsCache.data !== this._routeData) {
            this._routeStatsCache = {
                data: this._routeData,
                stats: BR.RouteLayerStats.calc(this._routeData.lines, this._routeData.times),
            };
        }
        return this._routeStatsCache.stats;
    },

    _renderList() {
        const $list = this._$list.empty();
        if (!this._layers.length) {
            $('<li class="route-layers-empty text-muted">')
                .text(
                    i18next.t(
                        'sidebar.route-layers.empty',
                        'No layers yet. Import GPX/KML/GeoJSON files, keep the current route with "New" or "Duplicate", or select a part of the elevation profile and save it as a layer.'
                    )
                )
                .appendTo($list);
            return;
        }

        for (const layer of this._layers) {
            const $item = $('<li class="route-layer" draggable="true">')
                .attr('data-layer-id', layer.id)
                .toggleClass('route-layer-hidden', !layer.visible);
            const $head = $('<div class="route-layer-head">').appendTo($item);
            $('<span class="route-layer-handle fa fa-bars">').appendTo($head);
            $('<input type="checkbox" class="route-layer-visible">')
                .prop('checked', layer.visible)
                .attr('title', i18next.t('sidebar.route-layers.toggle', 'Show/hide'))
                .appendTo($head);
            $('<input type="color" class="route-layer-color">')
                .val(layer.color)
                .attr('title', i18next.t('sidebar.route-layers.color', 'Color'))
                .appendTo($head);
            $('<span class="route-layer-name">')
                .text(layer.name)
                .attr('title', i18next.t('sidebar.route-layers.rename-hint', 'Double-click to rename'))
                .appendTo($head);

            const $actions = $('<span class="route-layer-actions">').appendTo($head);
            this._actionButton('zoom', 'fa-search-plus', 'sidebar.route-layers.zoom', 'Zoom to layer').appendTo(
                $actions
            );
            this._actionButton('profile', 'fa-area-chart', 'sidebar.route-layers.profile', 'Elevation profile')
                .toggleClass('active', this._profileSource === layer.id)
                .appendTo($actions);
            this._actionButton(
                'activate',
                'fa-pencil',
                'sidebar.route-layers.activate',
                'Edit as active route',
                layer.waypoints ? null : 'sidebar.route-layers.activate-track'
            ).appendTo($actions);
            this._actionButton('export', 'fa-download', 'sidebar.route-layers.export', 'Export GPX').appendTo($actions);
            this._actionButton('delete', 'fa-trash-o', 'sidebar.route-layers.delete', 'Delete layer').appendTo(
                $actions
            );

            $item.append(this._statsHtml(layer.brouterStats, layer.stats));
            $list.append($item);
        }
    },

    _actionButton(action, icon, key, defaultTitle, altKey) {
        let title = i18next.t(key, defaultTitle);
        if (altKey) {
            title += ' – ' + i18next.t(altKey, 'converted to waypoints, may route differently');
        }
        return $('<button type="button" class="btn btn-sm btn-link">')
            .attr('data-action', action)
            .attr('title', title)
            .append($('<i class="fa">').addClass(icon));
    },

    /**
     * Stats as shown in the footer for routes; BRouter values are used when available
     */
    _statsHtml(brouterStats, stats) {
        const num = (value, digits = 0) => L.Util.formatNum(value, digits).toLocaleString();
        const t = (key, def) => i18next.t(key, def);
        const items = [];

        const length = brouterStats ? brouterStats.trackLength : stats.trackLength;
        items.push([t('footer.distance', 'Distance'), num(length / 1000, 1), t('footer.kilometer-abbrev', 'km')]);

        const ascend = brouterStats ? brouterStats.filteredAscend : stats.filteredAscend;
        const plainAscend = brouterStats ? brouterStats.plainAscend : stats.plainAscend;
        if (stats.minElevation !== null) {
            items.push([t('footer.ascend', 'Ascend'), num(ascend) + ' (' + num(plainAscend) + ')', 'm']);
            items.push([t('sidebar.route-layers.descend', 'Descend'), num(stats.filteredDescend), 'm']);
            items.push([
                t('sidebar.route-layers.elevation', 'Elevation'),
                num(stats.minElevation) + '–' + num(stats.maxElevation),
                'm',
            ]);
        }

        const time = brouterStats ? brouterStats.totalTime : stats.totalTime;
        if (time !== null && time !== undefined) {
            const formatted = Math.trunc(time / 3600) + ':' + ('0' + Math.trunc((time % 3600) / 60)).slice(-2);
            items.push([t('footer.travel-time', 'Travel time'), formatted, t('footer.hours-abbrev', 'h')]);
        }

        if (brouterStats) {
            items.push([
                t('footer.total-energy', 'Total Energy'),
                num(brouterStats.totalEnergy / 3600000, 2),
                t('footer.kilowatthour-abbrev', 'kWh'),
            ]);
            items.push([t('footer.cost', 'Cost'), num(brouterStats.cost), '']);
        }

        const $stats = $('<dl class="route-layer-stats">');
        for (const [label, value, unit] of items) {
            const $cell = $('<div>').appendTo($stats);
            $('<dt>').text(label).appendTo($cell);
            $('<dd>')
                .text(value + (unit ? ' ' + unit : ''))
                .appendTo($cell);
        }
        return $stats;
    },
});

/**
 * Parses a GPX, KML or GeoJSON file into layer data (lines, times, name)
 */
BR.RouteLayers.parseFile = function (filename, text) {
    const ext = filename.split('.').pop().toLowerCase();
    let geoJson;
    if (ext === 'gpx' || ext === 'kml') {
        const xml = new DOMParser().parseFromString(text, 'text/xml');
        geoJson = toGeoJSON[ext](xml);
    } else {
        geoJson = JSON.parse(text);
    }

    const lines = [];
    const times = [];
    let hasTimes = true;
    let name = null;

    const toSeconds = (t) => (t ? Date.parse(t) / 1000 : NaN);
    const addLine = (coords, coordTimes) => {
        const line = coords.map((c) => (c.length > 2 && c[2] !== null ? [c[1], c[0], c[2]] : [c[1], c[0]]));
        if (line.length < 2) return;
        lines.push(line);
        if (coordTimes && coordTimes.length === coords.length) {
            times.push(coordTimes.map(toSeconds));
        } else {
            hasTimes = false;
        }
    };

    turf.featureEach(
        geoJson.type === 'FeatureCollection' ? geoJson : turf.featureCollection([].concat(geoJson)),
        (f) => {
            const props = f.properties || {};
            const geom = f.geometry;
            if (!geom) return;
            if (geom.type === 'LineString') {
                addLine(geom.coordinates, props.coordTimes || props.times);
            } else if (geom.type === 'MultiLineString') {
                const coordTimes = props.coordTimes || props.times;
                geom.coordinates.forEach((coords, i) => addLine(coords, coordTimes && coordTimes[i]));
            } else {
                return;
            }
            if (!name && props.name) name = props.name;
        }
    );

    if (!lines.length) return null;

    return {
        name: name || filename.replace(/\.[^.]*$/, ''),
        lines,
        times: hasTimes && times.length === lines.length ? times : null,
        source: 'file',
    };
};

BR.RouteLayers.toGeoJson = function (layer) {
    const coords = layer.lines.map((line) => line.map((p) => (p.length > 2 ? [p[1], p[0], p[2]] : [p[1], p[0]])));
    return turf.featureCollection([
        turf.feature(
            coords.length === 1
                ? { type: 'LineString', coordinates: coords[0] }
                : { type: 'MultiLineString', coordinates: coords },
            { name: layer.name }
        ),
    ]);
};

/**
 * Index of the point closest to `latLng` in `points`, searching from `from` on
 */
BR.RouteLayers.nearestIndex = function (points, latLng, from = 0) {
    let best = -1;
    let bestDist = Infinity;
    for (let i = from; i < points.length; i++) {
        const dLat = points[i][0] - latLng[0];
        const dLng = points[i][1] - latLng[1];
        const dist = dLat * dLat + dLng * dLng;
        if (dist < bestDist) {
            bestDist = dist;
            best = i;
        }
    }
    return best;
};

/**
 * Extracts the section between two positions (as [lat, lng]) of a route or layer into new layer data.
 * Keeps line breaks, per point times and the original waypoints within the section.
 */
BR.RouteLayers.extractSection = function (source, startLatLng, endLatLng) {
    // flatten with references to line and point index
    const flat = [];
    source.lines.forEach((line, li) => line.forEach((p, pi) => flat.push([p[0], p[1], li, pi])));

    let start = BR.RouteLayers.nearestIndex(flat, startLatLng);
    let end = BR.RouteLayers.nearestIndex(flat, endLatLng);
    if (start > end) [start, end] = [end, start];
    if (start === -1 || end - start < 1) return null;

    const lines = [];
    const times = source.times ? [] : null;
    for (let i = start; i <= end; i++) {
        const [, , li, pi] = flat[i];
        if (i === start || flat[i - 1][2] !== li) {
            lines.push([]);
            if (times) times.push([]);
        }
        lines[lines.length - 1].push(source.lines[li][pi]);
        if (times) times[times.length - 1].push(source.times[li][pi]);
    }

    let waypoints = null;
    if (source.waypoints) {
        waypoints = [flat[start].slice(0, 2)];
        let from = 0;
        for (const wp of source.waypoints) {
            const idx = BR.RouteLayers.nearestIndex(flat, wp, from);
            if (idx === -1) break;
            from = idx;
            if (idx > start && idx < end) waypoints.push(wp);
        }
        waypoints.push(flat[end].slice(0, 2));
    }

    return {
        lines: lines.filter((line) => line.length > 1),
        times: times ? times.filter((t) => t.length > 1) : null,
        waypoints,
    };
};

/**
 * Simplifies lines to at most `max` waypoints, for editing an imported track as route
 */
BR.RouteLayers.simplifyToWaypoints = function (lines, max) {
    const coords = [].concat(...lines).map((p) => [p[1], p[0]]);
    if (coords.length < 2) return null;
    let tolerance = 0.00001;
    let simplified = coords;
    while (simplified.length > max && tolerance < 1) {
        simplified = turf.simplify(turf.lineString(coords), { tolerance, highQuality: true }).geometry.coordinates;
        tolerance *= 2;
    }
    return simplified.map((c) => [c[1], c[0]]);
};
