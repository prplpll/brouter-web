/**
 * @jest-environment jsdom
 */

BR = {};
BR.conf = {};
$ = require('jquery');
require('leaflet');
require('leaflet-hotline')(L);
i18next = { t: (key) => key };
require('../../js/plugin/RoutingPathQuality.js');

const layersControl = { addOverlay() {} };

function createProviders() {
    document.body.innerHTML = '<div id="map" style="width: 400px; height: 400px"></div>';
    const map = L.map('map');
    return new BR.RoutingPathQuality(map, layersControl).providers;
}

function segment(latLngs) {
    return L.polyline(latLngs.map((ll) => L.latLng(ll)));
}

function hotlineValues(layers) {
    return layers.map((layer) => layer.getLatLngs().map((ll) => ll.alt));
}

// BRouter omits the elevation for some points, see #860 and #501
const partlyMissing = [
    [34.39, 133.19],
    [34.391, 133.191, 10],
    [34.392, 133.19],
    [34.393, 133.191, 20],
    [34.394, 133.19],
];

test('altitude: points without elevation get the previous value, or the next at the start', () => {
    const layers = createProviders().altitude.provider.computeLayers([segment(partlyMissing)]);

    expect(hotlineValues(layers)).toEqual([[10, 10, 10, 20, 20]]);
});

test('incline: no NaN values from points without elevation', () => {
    const layers = createProviders().incline.provider.computeLayers([segment(partlyMissing)]);

    for (const value of hotlineValues(layers)[0]) {
        expect(Number.isFinite(value)).toBe(true);
    }
});

test('values are filled across segments', () => {
    const layers = createProviders().altitude.provider.computeLayers([
        segment([
            [34.39, 133.19, 5],
            [34.391, 133.191, 6],
        ]),
        segment([
            [34.391, 133.191],
            [34.392, 133.19],
        ]),
    ]);

    expect(hotlineValues(layers)).toEqual([
        [5, 6],
        [6, 6],
    ]);
});

test('no color-coding when no point has elevation', () => {
    const noElevation = partlyMissing.map((ll) => ll.slice(0, 2));
    const providers = createProviders();

    expect(providers.altitude.provider.computeLayers([segment(noElevation)])).toEqual([]);
});
