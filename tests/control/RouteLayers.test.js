/**
 * @jest-environment jsdom
 */

BR = {};
BR.conf = {};
$ = require('jquery');
require('leaflet');
turf = require('@turf/turf');
toGeoJSON = require('@mapbox/togeojson');
require('../../js/util/CheapRuler.js');
require('../../js/util/RouteLayerStats.js');
require('../../js/control/RouteLayers.js');

const segments = require('./data/segments.json');

describe('RouteLayerStats', () => {
    test('calculates distance and elevation', () => {
        // ~111 m per 0.001° latitude
        const lines = [
            [
                [49.0, 8.0, 100],
                [49.001, 8.0, 105],
                [49.002, 8.0, 120],
                [49.003, 8.0, 118],
                [49.004, 8.0, 130],
                [49.005, 8.0, 100],
            ],
        ];
        const stats = BR.RouteLayerStats.calc(lines);

        expect(stats.trackLength).toBeGreaterThan(550);
        expect(stats.trackLength).toBeLessThan(560);
        expect(stats.plainAscend).toBe(32);
        expect(stats.plainDescend).toBe(32);
        // small dip of 2 m is filtered
        expect(stats.filteredAscend).toBe(30);
        // hysteresis absorbs the first 10 m of the descent after the climb
        expect(stats.filteredDescend).toBe(20);
        expect(stats.minElevation).toBe(100);
        expect(stats.maxElevation).toBe(130);
        expect(stats.totalTime).toBeNull();
    });

    test('handles missing elevation and times', () => {
        const stats = BR.RouteLayerStats.calc(
            [
                [
                    [49.0, 8.0],
                    [49.001, 8.0],
                ],
            ],
            [[10, 70]]
        );
        expect(stats.minElevation).toBeNull();
        expect(stats.totalTime).toBe(60);
    });

    test('sums BRouter segment stats', () => {
        const layers = segments.map((s) => ({ feature: s.feature }));
        const stats = BR.RouteLayerStats.fromSegments(layers);
        const expected = segments.reduce((sum, s) => sum + +s.feature.properties['track-length'], 0);
        expect(stats.trackLength).toBe(expected);
    });
});

describe('RouteLayers', () => {
    const source = {
        name: 'Test',
        lines: [
            [
                [49.0, 8.0, 100],
                [49.001, 8.0, 101],
                [49.002, 8.0, 102],
                [49.003, 8.0, 103],
                [49.004, 8.0, 104],
            ],
        ],
        times: [[0, 10, 20, 30, 40]],
        waypoints: [
            [49.0, 8.0],
            [49.002, 8.0],
            [49.004, 8.0],
        ],
    };

    test('extracts section with times and waypoints', () => {
        const section = BR.RouteLayers.extractSection(source, [49.001, 8.0], [49.003, 8.00001]);

        expect(section.lines).toEqual([source.lines[0].slice(1, 4)]);
        expect(section.times).toEqual([[10, 20, 30]]);
        expect(section.waypoints).toEqual([
            [49.001, 8.0],
            [49.002, 8.0],
            [49.003, 8.0],
        ]);
    });

    test('extracts section regardless of selection direction', () => {
        const section = BR.RouteLayers.extractSection(source, [49.003, 8.0], [49.001, 8.0]);
        expect(section.lines[0].length).toBe(3);
    });

    test('keeps line breaks in sections', () => {
        const multi = {
            lines: [source.lines[0].slice(0, 3), source.lines[0].slice(3)],
            times: null,
            waypoints: null,
        };
        const section = BR.RouteLayers.extractSection(multi, [49.001, 8.0], [49.004, 8.0]);
        expect(section.lines.length).toBe(2);
        expect(section.waypoints).toBeNull();
    });

    test('parses GPX with times', () => {
        const gpx = `<?xml version="1.0"?>
            <gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">
              <trk><name>Morning ride</name><trkseg>
                <trkpt lat="49.0" lon="8.0"><ele>100</ele><time>2024-01-01T10:00:00Z</time></trkpt>
                <trkpt lat="49.01" lon="8.0"><ele>110</ele><time>2024-01-01T10:05:00Z</time></trkpt>
              </trkseg></trk>
              <wpt lat="49.0" lon="8.0"><name>POI</name></wpt>
            </gpx>`;
        const data = BR.RouteLayers.parseFile('ride.gpx', gpx);

        expect(data.name).toBe('Morning ride');
        expect(data.lines).toEqual([
            [
                [49.0, 8.0, 100],
                [49.01, 8.0, 110],
            ],
        ]);
        expect(BR.RouteLayerStats.calc(data.lines, data.times).totalTime).toBe(300);
    });

    test('parses GeoJSON and returns null without lines', () => {
        const point = { type: 'Feature', geometry: { type: 'Point', coordinates: [8, 49] }, properties: {} };
        expect(BR.RouteLayers.parseFile('p.geojson', JSON.stringify(point))).toBeNull();

        const line = turf.lineString(
            [
                [8, 49],
                [8, 49.01],
            ],
            { name: 'L' }
        );
        const data = BR.RouteLayers.parseFile('l.geojson', JSON.stringify(line));
        expect(data.name).toBe('L');
        expect(data.times).toBeNull();
    });

    test('exports GeoJSON with elevation', () => {
        const geoJson = BR.RouteLayers.toGeoJson(source);
        expect(geoJson.features[0].geometry.type).toBe('LineString');
        expect(geoJson.features[0].geometry.coordinates[0]).toEqual([8.0, 49.0, 100]);
    });

    test('simplifies track to limited waypoints', () => {
        const line = [];
        for (let i = 0; i < 500; i++) {
            line.push([49 + i * 0.0001, 8 + Math.sin(i / 20) * 0.01]);
        }
        const waypoints = BR.RouteLayers.simplifyToWaypoints([line], 50);
        expect(waypoints.length).toBeLessThanOrEqual(50);
        expect(waypoints[0]).toEqual(line[0]);
        expect(waypoints[waypoints.length - 1]).toEqual(line[499]);
    });
});
