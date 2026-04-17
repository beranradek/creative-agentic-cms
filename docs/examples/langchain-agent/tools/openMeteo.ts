import * as z from "zod";
import { tool } from "langchain";
import { fetchJson } from "../lib/http.js";

const GeoResultSchema = z.object({
  id: z.number(),
  name: z.string(),
  latitude: z.number(),
  longitude: z.number(),
  country: z.string().optional(),
  admin1: z.string().optional(),
  timezone: z.string().optional(),
});

const GeocodingResponseSchema = z.object({
  results: z.array(GeoResultSchema).optional(),
});

const ForecastResponseSchema = z.object({
  latitude: z.number(),
  longitude: z.number(),
  timezone: z.string(),
  current: z
    .object({
      time: z.string(),
      temperature_2m: z.number().optional(),
      relative_humidity_2m: z.number().optional(),
      precipitation: z.number().optional(),
      wind_speed_10m: z.number().optional(),
      weather_code: z.number().optional(),
    })
    .optional(),
  current_units: z
    .object({
      temperature_2m: z.string().optional(),
      relative_humidity_2m: z.string().optional(),
      precipitation: z.string().optional(),
      wind_speed_10m: z.string().optional(),
    })
    .optional(),
});

function weatherCodeToText(code?: number): string | undefined {
  if (code === undefined) return undefined;
  const table: Record<number, string> = {
    0: "Clear sky",
    1: "Mainly clear",
    2: "Partly cloudy",
    3: "Overcast",
    45: "Fog",
    48: "Depositing rime fog",
    51: "Light drizzle",
    53: "Moderate drizzle",
    55: "Dense drizzle",
    56: "Light freezing drizzle",
    57: "Dense freezing drizzle",
    61: "Slight rain",
    63: "Moderate rain",
    65: "Heavy rain",
    66: "Light freezing rain",
    67: "Heavy freezing rain",
    71: "Slight snow fall",
    73: "Moderate snow fall",
    75: "Heavy snow fall",
    77: "Snow grains",
    80: "Slight rain showers",
    81: "Moderate rain showers",
    82: "Violent rain showers",
    85: "Slight snow showers",
    86: "Heavy snow showers",
    95: "Thunderstorm",
    96: "Thunderstorm with slight hail",
    99: "Thunderstorm with heavy hail",
  };
  return table[code] ?? `Weather code ${code}`;
}

async function resolveLocation(location: string, timeoutMs: number) {
  const url =
    "https://geocoding-api.open-meteo.com/v1/search?" +
    new URLSearchParams({
      name: location,
      count: "1",
      language: "en",
      format: "json",
    }).toString();

  const raw = await fetchJson<unknown>(url, { timeoutMs });
  const parsed = GeocodingResponseSchema.parse(raw);
  const first = parsed.results?.[0];
  if (!first) {
    throw new Error(`No geocoding results for location: ${location}`);
  }
  return first;
}

async function getCurrentWeather(lat: number, lon: number, timeoutMs: number) {
  const url =
    "https://api.open-meteo.com/v1/forecast?" +
    new URLSearchParams({
      latitude: String(lat),
      longitude: String(lon),
      current:
        "temperature_2m,relative_humidity_2m,precipitation,weather_code,wind_speed_10m",
      timezone: "auto",
    }).toString();

  const raw = await fetchJson<unknown>(url, { timeoutMs });
  return ForecastResponseSchema.parse(raw);
}

export const getWeatherForLocation = tool(
  async ({ location }: { location: string }) => {
    const timeoutSeconds = Number(process.env.TIMEOUT_SECONDS ?? "30");
    const timeoutMs = Number.isFinite(timeoutSeconds) ? timeoutSeconds * 1000 : 30_000;

    const geo = await resolveLocation(location, timeoutMs);
    const forecast = await getCurrentWeather(geo.latitude, geo.longitude, timeoutMs);

    const current = forecast.current;
    const result = {
      source: "open-meteo" as const,
      location: {
        name: geo.name,
        admin1: geo.admin1,
        country: geo.country,
        latitude: geo.latitude,
        longitude: geo.longitude,
        timezone: geo.timezone ?? forecast.timezone,
      },
      current: {
        time: current?.time,
        temperature_2m: current?.temperature_2m,
        temperature_unit: forecast.current_units?.temperature_2m,
        relative_humidity_2m: current?.relative_humidity_2m,
        relative_humidity_unit: forecast.current_units?.relative_humidity_2m,
        precipitation: current?.precipitation,
        precipitation_unit: forecast.current_units?.precipitation,
        wind_speed_10m: current?.wind_speed_10m,
        wind_speed_unit: forecast.current_units?.wind_speed_10m,
        weather_code: current?.weather_code,
        weather_text: weatherCodeToText(current?.weather_code),
      },
    };

    return JSON.stringify(result);
  },
  {
    name: "get_weather_for_location",
    description:
      "Get current weather for a given location (city name). Uses Open-Meteo for geocoding + current conditions.",
    schema: z.object({
      location: z.string().describe("City or place name, e.g. 'Prague' or 'Tokyo'"),
    }),
  }
);
