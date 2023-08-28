// Adapted from: https://github.com/springmeyer/arc.js/releases/tag/v0.1.4
// License: BSD 2-Clause "Simplified" License

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

// ------------------------------------------------------------

const Coord = function(lon, lat) {
  // in degrees
  this.lon = lon;
  this.lat = lat;
  // in radians
  this.x = D2R * lon;
  this.y = D2R * lat;
};

/*
 * return coordinate decimal values rounded to 5 places (accurate to a ~1 meter)
 * https://stackoverflow.com/questions/11832914/how-to-round-to-at-most-2-decimal-places-if-necessary
 */
Coord.prototype.rounded = function() {
  const PRECISION = 5;
  const MULTIPLIER = Math.pow(10, PRECISION);
  const lon = Math.round((this.lon + Number.EPSILON) * MULTIPLIER) / MULTIPLIER;
  const lat = Math.round((this.lat + Number.EPSILON) * MULTIPLIER) / MULTIPLIER;
  return [lon, lat];
}

// ------------------------------------------------------------

const Arc = function(start, end) {

  this.start = start;
  this.end = end;
  this.lineStrings = [];

  // Compute great-circle distance (Δσ) in radians
  // http://en.wikipedia.org/wiki/Great-circle_distance

  const Δλ = this.end.x - this.start.x;
  const Δφ = this.end.y - this.start.y;
  const z = Math.pow(Math.sin(Δφ / 2.0), 2) + Math.cos(this.start.y) * Math.cos(this.end.y) * Math.pow(Math.sin(Δλ / 2.0), 2);
  this.Δσ = 2.0 * Math.asin(Math.sqrt(z));

  if (this.Δσ === Math.PI) {
    throw new Error(`it appears ${start} and ${end} are exactly ‘antipodal’`);
  }
  else if (isNaN(this.Δσ)) {
    throw new Error(`could not calculate great circle between ${start} and ${end}`);
  }

  /*
   * http://web.archive.org/web/20161209044600/williams.best.vwh.net/avform.htm#Intermediate
   */
  const interpolate = (frac) => {
    const A = Math.sin((1 - frac) * this.Δσ) / Math.sin(this.Δσ);
    const B = Math.sin(frac * this.Δσ) / Math.sin(this.Δσ);
    const x = A * Math.cos(this.start.y) * Math.cos(this.start.x) + B * Math.cos(this.end.y) * Math.cos(this.end.x);
    const y = A * Math.cos(this.start.y) * Math.sin(this.start.x) + B * Math.cos(this.end.y) * Math.sin(this.end.x);
    const z = A * Math.sin(this.start.y) + B * Math.sin(this.end.y);
    const lat = R2D * Math.atan2(z, Math.sqrt(Math.pow(x, 2) + Math.pow(y, 2)));
    const lon = R2D * Math.atan2(y, x);
    return new Coord(lon, lat);
  };

  // Generate points along the great circle at an interval of ~3°

  const numPoints = Math.max(2, Math.ceil(this.Δσ / 0.05));
  const firstPass = [];
  for (let step = 0; step < numPoints; step++) {
    firstPass.push(interpolate(step * 1.0 / (numPoints - 1)));
  }

  // partial port of dateline handling from: gdal/ogr/ogrgeometryfactory.cpp

  let bHasBigDiff = false;
  let dfMaxSmallDiffLong = 0;
  for (let i = 1; i < firstPass.length; i++) {
    const dfPrevX = firstPass[i - 1].lon;
    const dfX = firstPass[i].lon;
    const dfDiffLon = Math.abs(dfX - dfPrevX);
    if (dfDiffLon > 350 && ((dfX > 170 && dfPrevX < -170) || (dfPrevX > 170 && dfX < -170))) {
      bHasBigDiff = true;
    }
    else if (dfDiffLon > dfMaxSmallDiffLong) {
      dfMaxSmallDiffLong = dfDiffLon;
    }
  }

  if (bHasBigDiff && dfMaxSmallDiffLong < 10) {
    let poNewLS = [];
    this.lineStrings.push(poNewLS);
    for (let i = 0; i < firstPass.length; i++) {
      const dfX = parseFloat(firstPass[i].lon);
      if (i > 0 &&  Math.abs(dfX - firstPass[i - 1][0]) > 350) {
        let dfX1 = parseFloat(firstPass[i - 1].lon);
        let dfY1 = parseFloat(firstPass[i - 1].lat);
        let dfX2 = parseFloat(firstPass[i].lon);
        let dfY2 = parseFloat(firstPass[i].lat);
        if (
          dfX1 > -180 && dfX1 < -170 && dfX2 == 180 &&
          i + 1 < firstPass.length &&
          firstPass[i - 1].lon > -180 && firstPass[i - 1].lon < -170
        ) {
          poNewLS.push(new Coord(-180, firstPass[i].lat));
          i++;
          poNewLS.push(new Coord(firstPass[i].lon, firstPass[i].lat));
          continue;
        }
        else if (
          dfX1 > 170 && dfX1 < 180 && dfX2 == -180 &&
          i + 1 < firstPass.length &&
          firstPass[i - 1].lon > 170 && firstPass[i - 1].lon < 180
        ) {
          poNewLS.push(new Coord(180, firstPass[i].lat));
          i++;
          poNewLS.push(new Coord(firstPass[i].lon, firstPass[i].lat));
          continue;
        }

        if (dfX1 < -170 && dfX2 > 170) {
          // swap dfX1, dfX2
          const tmpX = dfX1;
          dfX1 = dfX2;
          dfX2 = tmpX;
          // swap dfY1, dfY2
          const tmpY = dfY1;
          dfY1 = dfY2;
          dfY2 = tmpY;
        }
        if (dfX1 > 170 && dfX2 < -170) {
          dfX2 += 360;
        }

        if (dfX1 <= 180 && dfX2 >= 180 && dfX1 < dfX2) {
          const dfRatio = (180 - dfX1) / (dfX2 - dfX1);
          const dfY = dfRatio * dfY2 + (1 - dfRatio) * dfY1;
          poNewLS.push(new Coord(firstPass[i-1].lon > 170 ? 180 : -180, dfY));
          poNewLS = [];
          poNewLS.push(new Coord(firstPass[i-1].lon > 170 ? -180 : 180, dfY));
          this.lineStrings.push(poNewLS);
        }
        else {
          poNewLS = [];
          this.lineStrings.push(poNewLS);
        }
        poNewLS.push(new Coord(dfX, firstPass[i].lat));
      }
      else {
        poNewLS.push(firstPass[i]);
      }
    }
  }
  else {
    const poNewLS = [...firstPass];
    this.lineStrings = [poNewLS];
  }
};

Arc.prototype.toGeoJson = function() {

  if (this.lineStrings.length <= 0) {
    throw new Error(`arc is empty`);
  }

  const isMulti = this.lineStrings.length > 1;
  const feature = {
    geometry: {
      type: isMulti ? 'MultiLineString' : 'LineString',
      coordinates: isMulti
        ? [this.lineStrings.map(g => g.map(c => c.rounded()))]
        : this.lineStrings[0].map(c => c.rounded()),
    },
    type: 'Feature',
  }

  return feature;
};
