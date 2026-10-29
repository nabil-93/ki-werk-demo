export interface TwinPalette {
  bg: string;
  fog: string;
  machineBody: string;
  machineDark: string;
  machineAccent: string;
  steel: string;
  wall: string;
  wallTop: string;
  hallFloorA: string;
  hallFloorB: string;
  marking: string;
  aisle: string;
  silo: string;
  rack: string;
  text: string;
  emissiveBoost: number;
  hemiSky: string;
  hemiGround: string;
  hemiIntensity: number;
  sunIntensity: number;
}

export const LIGHT: TwinPalette = {
  // Himmel/Dunst über dem Mittelgebirge
  bg: "#d6e1ea",
  fog: "#d6e1ea",
  machineBody: "#f3f4f1",
  machineDark: "#2b3038",
  machineAccent: "#c9ced6",
  steel: "#9aa3ad",
  wall: "#cfd4cc",
  wallTop: "#b9bfb6",
  hallFloorA: "#d6dad3",
  hallFloorB: "#d3d8d4",
  marking: "#e0b021",
  aisle: "#c9cec6",
  silo: "#dfe3e8",
  rack: "#3c64d8",
  text: "#20252c",
  emissiveBoost: 1,
  hemiSky: "#ffffff",
  hemiGround: "#9aa889",
  hemiIntensity: 1.15,
  sunIntensity: 2.3,
};

export const DARK: TwinPalette = {
  bg: "#0a0f15",
  fog: "#0a0f15",
  machineBody: "#2a3039",
  machineDark: "#12161b",
  machineAccent: "#3a424d",
  steel: "#58616c",
  wall: "#1b2027",
  wallTop: "#262c34",
  hallFloorA: "#161b21",
  hallFloorB: "#151a1f",
  marking: "#a77f12",
  aisle: "#1d232a",
  silo: "#2c333c",
  rack: "#2f4fae",
  text: "#e6e9ec",
  emissiveBoost: 2.2,
  hemiSky: "#9fb3d1",
  hemiGround: "#0b0e12",
  hemiIntensity: 0.55,
  sunIntensity: 0.9,
};
