export type EmergencyType =
  | "fire"
  | "flood"
  | "medical"
  | "accident"
  | "collapse"
  | "hazmat"
  | "landslide"
  | "cyclone"
  | "other";

export type SeverityLevel = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
export type ResourceType =
  | "ambulance"
  | "police"
  | "fire_truck"
  | "boat"
  | "drone"
  | "bus";
export type ResourceStatus =
  | "AVAILABLE"
  | "EN_ROUTE"
  | "ON_SCENE"
  | "BUSY"
  | "OUT_OF_SERVICE";

export type ReportStage =
  | "Reported"
  | "Acknowledged"
  | "Dispatched"
  | "On Scene"
  | "Resolved";

export interface ReportRecord {
  id: string;
  incidentId: string;
  type: EmergencyType;
  label: string;
  phone: string;
  people: number;
  vulnerable: boolean;
  vulnerableGroups: string[];
  spreading: boolean;
  structuralDamage: boolean;
  description: string;
  mediaEvidence: boolean;
  mediaPreview?: string;
  lat: number;
  lng: number;
  address: string;
  createdAt: string;
  source: "app" | "call" | "sms";
  gpsVerified: boolean;
  severityScore: number;
  severityLevel: SeverityLevel;
  confidenceScore: number;
  confidenceLabel: string;
  status: ReportStage;
}

export interface IncidentRecord {
  id: string;
  type: EmergencyType;
  label: string;
  title: string;
  location: string;
  lat: number;
  lng: number;
  people: number;
  severityScore: number;
  severityLevel: SeverityLevel;
  confidenceScore: number;
  confidenceLabel: string;
  status: "NEW" | "ACKNOWLEDGED" | "DISPATCHED" | "ON_SCENE" | "RESOLVED";
  createdAt: string;
  reportIds: string[];
  evidence: string[];
  vulnerable: boolean;
  spreading: boolean;
  structuralDamage: boolean;
  assignedResourceIds: string[];
  zone: string;
  simulated?: boolean;
}

export interface ResourceRecord {
  id: string;
  type: ResourceType;
  label: string;
  lat: number;
  lng: number;
  status: ResourceStatus;
  zone: string;
  crew: string;
  speed: number;
  capacity?: number;
}

export interface HospitalRecord {
  id: string;
  name: string;
  lat: number;
  lng: number;
  capacity: {
    total: number;
    available: number;
    icuFree: number;
  };
  specializations: string[];
  status: "available" | "near_capacity" | "full";
}

export interface ZoneRecord {
  id: string;
  name: string;
  lat: number;
  lng: number;
  population: number;
  elderly: number;
  children: number;
  disabled: number;
  medicalDependent: number;
  households: number;
  hazardSeverity: number;
  exposure: number;
  vulnerability: number;
  accessRisk: number;
  progression: number;
  roadAccess: "OPEN" | "CONSTRAINED" | "LIMITED" | "BLOCKED";
  trend: "stable" | "rising" | "rapidly rising";
  evacuationStatus: "monitor" | "prepare" | "evacuating" | "partial";
}

export interface ShelterRecord {
  id: string;
  name: string;
  lat: number;
  lng: number;
  maximumCapacity: number;
  currentOccupancy: number;
  reservedCapacity: number;
  medicalSupport: boolean;
  accessibleForDisabled: boolean;
  status: "AVAILABLE" | "NEAR CAPACITY" | "FULL" | "UNREACHABLE";
  roadSafety: number;
  zone: string;
}

export interface AssignmentRecord {
  id: string;
  incidentId: string;
  resourceId: string;
  status: "ASSIGNED" | "ACCEPTED" | "EN_ROUTE" | "ON_SCENE" | "RESOLVED";
  etaMin: number;
  createdAt: string;
  updatedAt: string;
}

export const emergencyLabels: Record<EmergencyType, string> = {
  fire: "Fire",
  flood: "Flood",
  medical: "Medical Emergency",
  accident: "Road Accident",
  collapse: "Structural Collapse",
  hazmat: "Chemical / Hazmat",
  landslide: "Landslide",
  cyclone: "Cyclone",
  other: "Other",
};

export const demoReports = [
  {
    source: "VOICE / CALL",
    status: "Emergency-call source",
    text: "Water is entering my house near Riverside Bridge. I cannot walk properly and I need help.",
    meta: "Elderly citizen • Riverside Bridge area",
  },
  {
    source: "SMS REPORT",
    status: "Independent confirmation",
    text: "FLOOD near Riverside Bridge. Water level rising quickly. Vehicles are getting stuck.",
    meta: "Citizen SMS report • same zone",
  },
  {
    source: "IMAGE / APP",
    status: "GPS + visual evidence",
    text: "Bus trapped in flood water. Several passengers may still be inside.",
    meta: "GPS verified • linked to F-101",
  },
];

export const demoIncident: IncidentRecord = {
  id: "F-101",
  type: "flood",
  label: "Urban Flood Emergency",
  title: "Urban Flood Emergency",
  location: "Zone 4 – Riverside Bridge",
  lat: 13.0124,
  lng: 80.2268,
  people: 24,
  severityScore: 100,
  severityLevel: "CRITICAL",
  confidenceScore: 100,
  confidenceLabel: "VERIFIED",
  status: "ACKNOWLEDGED",
  createdAt: new Date(Date.now() - 9 * 60 * 1000).toISOString(),
  reportIds: ["CALL-F101", "SMS-F101", "APP-F101"],
  evidence: ["CALL", "SMS", "PHOTO + GPS"],
  vulnerable: true,
  spreading: true,
  structuralDamage: false,
  assignedResourceIds: ["A2", "P3", "B1"],
  zone: "Zone 4",
  simulated: true,
};

export const demoPhases = [
  { title: "SYSTEM MONITORING", seconds: 3 },
  { title: "EMERGENCY CALL RECEIVED", seconds: 5 },
  { title: "SMS REPORT RECEIVED", seconds: 4 },
  { title: "PHOTO + GPS RECEIVED", seconds: 5 },
  { title: "INCIDENT FUSION", seconds: 4 },
  { title: "CRITICAL INCIDENT CONFIRMED", seconds: 4 },
  { title: "SCANNING AMBULANCES", seconds: 6 },
  { title: "SCANNING POLICE UNITS", seconds: 6 },
  { title: "SCANNING RESCUE BOATS", seconds: 5 },
  { title: "BEST RESPONSE IDENTIFIED", seconds: 4 },
  { title: "PREPARING ROUTES", seconds: 3 },
  { title: "RESOURCES DISPATCHED", seconds: 9 },
  { title: "ROAD FLOOD WARNING", seconds: 4 },
  { title: "REROUTING", seconds: 4 },
  { title: "SAFE ROUTE FOUND", seconds: 9 },
  { title: "PREDICTIVE FLOOD ALERT", seconds: 5 },
  { title: "PRE-POSITION RESOURCES", seconds: 8 },
  { title: "RESPONSE ACTIVE", seconds: 999 },
];

export const initialResources: ResourceRecord[] = [
  {
    id: "A1",
    type: "ambulance",
    label: "Ambulance A1",
    lat: 13.036,
    lng: 80.245,
    status: "AVAILABLE",
    zone: "Zone 5",
    crew: "2 EMT",
    speed: 50,
  },
  {
    id: "A2",
    type: "ambulance",
    label: "Ambulance A2",
    lat: 13.02,
    lng: 80.23,
    status: "AVAILABLE",
    zone: "Zone 4",
    crew: "2 EMT",
    speed: 50,
  },
  {
    id: "A3",
    type: "ambulance",
    label: "Ambulance A3",
    lat: 13.016,
    lng: 80.226,
    status: "BUSY",
    zone: "Zone 4",
    crew: "2 EMT",
    speed: 50,
  },
  {
    id: "P1",
    type: "police",
    label: "Police P1",
    lat: 13.032,
    lng: 80.215,
    status: "AVAILABLE",
    zone: "Zone 5",
    crew: "4 officers",
    speed: 55,
  },
  {
    id: "P2",
    type: "police",
    label: "Police P2",
    lat: 13.028,
    lng: 80.24,
    status: "AVAILABLE",
    zone: "Zone 5",
    crew: "3 officers",
    speed: 55,
  },
  {
    id: "P3",
    type: "police",
    label: "Police P3",
    lat: 13.008,
    lng: 80.236,
    status: "AVAILABLE",
    zone: "Zone 4",
    crew: "3 officers",
    speed: 55,
  },
  {
    id: "F1",
    type: "fire_truck",
    label: "Fire Truck F1",
    lat: 13.024,
    lng: 80.257,
    status: "AVAILABLE",
    zone: "Zone 3",
    crew: "6 firefighters",
    speed: 40,
  },
  {
    id: "F2",
    type: "fire_truck",
    label: "Fire Truck F2",
    lat: 13.058,
    lng: 80.268,
    status: "AVAILABLE",
    zone: "Zone 6",
    crew: "5 firefighters",
    speed: 40,
  },
  {
    id: "B1",
    type: "boat",
    label: "Rescue Boat B1",
    lat: 13.006,
    lng: 80.224,
    status: "AVAILABLE",
    zone: "Zone 4",
    crew: "4 rescue",
    speed: 15,
    capacity: 12,
  },
  {
    id: "B2",
    type: "boat",
    label: "Rescue Boat B2",
    lat: 13.0,
    lng: 80.238,
    status: "AVAILABLE",
    zone: "Zone 4",
    crew: "4 rescue",
    speed: 15,
    capacity: 10,
  },
  {
    id: "D1",
    type: "drone",
    label: "Drone D1",
    lat: 13.041,
    lng: 80.236,
    status: "AVAILABLE",
    zone: "Zone 5",
    crew: "UAV team",
    speed: 80,
  },
  {
    id: "E1",
    type: "bus",
    label: "Evac Bus E1",
    lat: 13.048,
    lng: 80.21,
    status: "AVAILABLE",
    zone: "Zone 5",
    crew: "Driver + marshal",
    speed: 35,
    capacity: 45,
  },
  {
    id: "E2",
    type: "bus",
    label: "Evac Bus E2",
    lat: 12.999,
    lng: 80.21,
    status: "AVAILABLE",
    zone: "Zone 4",
    crew: "Driver + marshal",
    speed: 35,
    capacity: 45,
  },
];

export const hospitals: HospitalRecord[] = [
  {
    id: "H1",
    name: "Riverside General Hospital",
    lat: 13.031,
    lng: 80.241,
    capacity: { total: 420, available: 62, icuFree: 9 },
    specializations: ["general", "infectious", "trauma"],
    status: "available",
  },
  {
    id: "H2",
    name: "Metro Trauma & Burns Centre",
    lat: 13.062,
    lng: 80.263,
    capacity: { total: 300, available: 35, icuFree: 6 },
    specializations: ["trauma", "burns", "neuro"],
    status: "near_capacity",
  },
  {
    id: "H3",
    name: "South Coast Medical College",
    lat: 12.991,
    lng: 80.23,
    capacity: { total: 650, available: 118, icuFree: 18 },
    specializations: ["general", "cardiac", "infectious"],
    status: "available",
  },
  {
    id: "H4",
    name: "Harbor Emergency Unit",
    lat: 13.018,
    lng: 80.285,
    capacity: { total: 120, available: 0, icuFree: 0 },
    specializations: ["general"],
    status: "full",
  },
];

export const zones: ZoneRecord[] = [
  {
    id: "Z4",
    name: "Zone 4 – Riverside Habitation",
    lat: 13.0124,
    lng: 80.2268,
    population: 620,
    elderly: 84,
    children: 132,
    disabled: 19,
    medicalDependent: 12,
    households: 166,
    hazardSeverity: 92,
    exposure: 88,
    vulnerability: 74,
    accessRisk: 76,
    progression: 84,
    roadAccess: "LIMITED",
    trend: "rapidly rising",
    evacuationStatus: "prepare",
  },
  {
    id: "Z5",
    name: "Zone 5 – Canal East",
    lat: 13.026,
    lng: 80.239,
    population: 810,
    elderly: 96,
    children: 151,
    disabled: 23,
    medicalDependent: 19,
    households: 220,
    hazardSeverity: 68,
    exposure: 72,
    vulnerability: 62,
    accessRisk: 58,
    progression: 74,
    roadAccess: "CONSTRAINED",
    trend: "rising",
    evacuationStatus: "monitor",
  },
  {
    id: "Z2",
    name: "Zone 2 – Market Junction",
    lat: 13.05,
    lng: 80.267,
    population: 470,
    elderly: 41,
    children: 86,
    disabled: 9,
    medicalDependent: 8,
    households: 122,
    hazardSeverity: 38,
    exposure: 52,
    vulnerability: 41,
    accessRisk: 33,
    progression: 28,
    roadAccess: "OPEN",
    trend: "stable",
    evacuationStatus: "monitor",
  },
  {
    id: "Z7",
    name: "Zone 7 – Industrial Edge",
    lat: 13.073,
    lng: 80.286,
    population: 360,
    elderly: 28,
    children: 52,
    disabled: 8,
    medicalDependent: 5,
    households: 88,
    hazardSeverity: 64,
    exposure: 46,
    vulnerability: 42,
    accessRisk: 61,
    progression: 56,
    roadAccess: "CONSTRAINED",
    trend: "rising",
    evacuationStatus: "monitor",
  },
];

export const initialShelters: ShelterRecord[] = [
  {
    id: "S1",
    name: "North Civic Shelter",
    lat: 13.039,
    lng: 80.218,
    maximumCapacity: 500,
    currentOccupancy: 380,
    reservedCapacity: 25,
    medicalSupport: true,
    accessibleForDisabled: true,
    status: "AVAILABLE",
    roadSafety: 88,
    zone: "Zone 5",
  },
  {
    id: "S2",
    name: "Canal East School Relief Center",
    lat: 13.032,
    lng: 80.252,
    maximumCapacity: 800,
    currentOccupancy: 300,
    reservedCapacity: 35,
    medicalSupport: true,
    accessibleForDisabled: false,
    status: "AVAILABLE",
    roadSafety: 78,
    zone: "Zone 5",
  },
  {
    id: "S3",
    name: "South Stadium Safe Camp",
    lat: 12.997,
    lng: 80.214,
    maximumCapacity: 750,
    currentOccupancy: 250,
    reservedCapacity: 40,
    medicalSupport: false,
    accessibleForDisabled: true,
    status: "AVAILABLE",
    roadSafety: 82,
    zone: "Zone 3",
  },
  {
    id: "S4",
    name: "Riverside Community Hall",
    lat: 13.013,
    lng: 80.229,
    maximumCapacity: 220,
    currentOccupancy: 210,
    reservedCapacity: 10,
    medicalSupport: false,
    accessibleForDisabled: false,
    status: "FULL",
    roadSafety: 28,
    zone: "Zone 4",
  },
];

export const roadHazards = [
  {
    id: "RZ-1",
    name: "Riverside Road flood depth rising",
    lat: 13.0165,
    lng: 80.226,
    radiusMeters: 240,
    kind: "flooded road",
    detour: [13.02, 80.2165] as const,
  },
  {
    id: "RZ-2",
    name: "Bridge inspection warning",
    lat: 13.028,
    lng: 80.235,
    radiusMeters: 180,
    kind: "bridge unsafe",
    detour: [13.037, 80.226] as const,
  },
];
