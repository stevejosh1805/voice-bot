// Weather from Open-Meteo: free, no API key, works straight from the browser.

const CODES = {
  0: 'clear skies', 1: 'mostly clear', 2: 'partly cloudy', 3: 'overcast',
  45: 'foggy', 48: 'foggy', 51: 'light drizzle', 53: 'drizzle', 55: 'heavy drizzle',
  56: 'freezing drizzle', 57: 'freezing drizzle', 61: 'light rain', 63: 'rain', 65: 'heavy rain',
  66: 'freezing rain', 67: 'freezing rain', 71: 'light snow', 73: 'snow', 75: 'heavy snow',
  77: 'snow grains', 80: 'light showers', 81: 'showers', 82: 'heavy showers',
  85: 'snow showers', 86: 'heavy snow showers', 95: 'thunderstorms', 96: 'thunderstorms with hail', 99: 'thunderstorms with hail',
};

async function geocode(name) {
  const url = `https://geocoding-api.open-meteo.com/v1/search?count=1&language=en&format=json&name=${encodeURIComponent(name)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('The place lookup service did not respond. Try again in a moment.');
  const data = await res.json();
  const r = data.results?.[0];
  if (!r) return null;
  return { lat: r.latitude, lon: r.longitude, name: r.name };
}

function geolocate() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude, name: 'your area' }),
      () => resolve(null),
      { timeout: 8000, maximumAge: 10 * 60 * 1000 },
    );
  });
}

export async function getWeather({ place, defaultCity, units = 'celsius', tomorrow = false }) {
  let loc = null;
  if (place) {
    loc = await geocode(place);
    if (!loc) throw new Error(`I couldn't find a place called ${place}.`);
  } else if (defaultCity) {
    loc = await geocode(defaultCity);
  }
  if (!loc) loc = await geolocate();
  if (!loc) throw new Error('Tell me a city, like "weather in Chennai", or set a home city in Settings.');

  const params = new URLSearchParams({
    latitude: loc.lat,
    longitude: loc.lon,
    current: 'temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
    timezone: 'auto',
    forecast_days: '2',
    temperature_unit: units,
  });
  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
  if (!res.ok) throw new Error('The weather service did not respond. Try again in a moment.');
  const d = await res.json();
  const r = Math.round;

  if (tomorrow) {
    const i = 1;
    const sky = CODES[d.daily.weather_code[i]] || 'mixed conditions';
    return `Tomorrow in ${loc.name}: ${sky}, a high of ${r(d.daily.temperature_2m_max[i])} and a low of ${r(d.daily.temperature_2m_min[i])} degrees, with a ${d.daily.precipitation_probability_max[i] ?? 0} percent chance of rain.`;
  }
  const c = d.current;
  const sky = CODES[c.weather_code] || 'mixed conditions';
  return `Right now in ${loc.name} it's ${r(c.temperature_2m)} degrees and ${sky}, feeling like ${r(c.apparent_temperature)}, with ${r(c.relative_humidity_2m)} percent humidity. Today's high is ${r(d.daily.temperature_2m_max[0])}, and there's a ${d.daily.precipitation_probability_max[0] ?? 0} percent chance of rain.`;
}
