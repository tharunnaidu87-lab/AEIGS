import {
  AssignmentRecord,
  EmergencyType,
  HospitalRecord,
  IncidentRecord,
  ReportRecord,
  ResourceRecord,
  ResourceType,
  SeverityLevel,
  ShelterRecord,
  ZoneRecord,
  emergencyLabels,
} from "./data";

export interface SeverityInput {
  type: EmergencyType | string;
  people: number;
  vulnerable: boolean;
  structuralDamage: boolean;
  spreading: boolean;
  mediaEvidence: boolean;
}

export interface ScoreFactor {
  label: string;
  value: number;
}

const severityBase: Record<EmergencyType, { base: number; spread: number }> = {
  fire: { base: 85, spread: 0.9 },
  flood: { base: 80, spread: 0.7 },
  medical: { base: 75, spread: 0.1 },
  accident: { base: 70, spread: 0.3 },
  collapse: { base: 90, spread: 0.4 },
  hazmat: { base: 88, spread: 0.8 },
  landslide: { base: 86, spread: 0.55 },
  cyclone: { base: 82, spread: 0.85 },
  other: { base: 50, spread: 0.2 },
};

const requirementMap: Record<EmergencyType, ResourceType[]> = {
  fire: ["fire_truck", "ambulance", "police"],
  flood: ["boat", "ambulance", "police"],
  medical: ["ambulance"],
  accident: ["ambulance", "police", "fire_truck"],
  collapse: ["fire_truck", "ambulance", "police"],
  hazmat: ["fire_truck", "police", "ambulance"],
  landslide: ["fire_truck", "ambulance", "police", "drone"],
  cyclone: ["boat", "ambulance", "police", "bus"],
  other: ["police", "ambulance"],
};

const speedByType: Record<ResourceType, number> = {
  ambulance: 50,
  police: 55,
  fire_truck: 40,
  boat: 15,
  drone: 80,
  bus: 35,
};

export function normalizeEmergencyType(value: string): EmergencyType {
  const clean = value.toLowerCase().replace(/[\s/_-]+/g, "");
  if (clean.includes("fire")) return "fire";
  if (clean.includes("flood")) return "flood";
  if (clean.includes("medical") || clean.includes("health")) return "medical";
  if (clean.includes("accident") || clean.includes("road")) return "accident";
  if (clean.includes("collapse") || clean.includes("structural")) return "collapse";
  if (clean.includes("hazmat") || clean.includes("chemical")) return "hazmat";
  if (clean.includes("landslide")) return "landslide";
  if (clean.includes("cyclone")) return "cyclone";
  return "other";
}

export function severityClass(score: number): SeverityLevel {
  if (score >= 80) return "CRITICAL";
  if (score >= 60) return "HIGH";
  if (score >= 40) return "MEDIUM";
  return "LOW";
}

export function calculateSeverity(input: SeverityInput) {
  const type = normalizeEmergencyType(input.type);
  const factors: ScoreFactor[] = [];
  const base = severityBase[type];
  factors.push({ label: `${emergencyLabels[type]} base`, value: base.base });
  const peopleFactor = Math.min(Math.max(input.people, 0) * 3, 20);
  factors.push({ label: "People in danger", value: peopleFactor });
  if (input.vulnerable) factors.push({ label: "Vulnerable people present", value: 10 });
  if (input.structuralDamage) factors.push({ label: "Structural damage", value: 8 });
  if (input.spreading) factors.push({ label: "Spreading / getting worse", value: base.spread * 10 });
  if (input.mediaEvidence) factors.push({ label: "Photo/video evidence", value: 2 });
  const score = Math.min(
    100,
    Math.round(factors.reduce((sum, factor) => sum + factor.value, 0)),
  );
  return { type, score, level: severityClass(score), factors };
}

export function calculateConfidence(input: {
  emergencyCall?: boolean;
  sms?: boolean;
  mediaEvidence?: boolean;
  gpsVerified?: boolean;
  multipleReports?: boolean;
}) {
  const factors: ScoreFactor[] = [{ label: "Base confidence", value: 20 }];
  if (input.emergencyCall) factors.push({ label: "Verified emergency-call source", value: 15 });
  if (input.sms) factors.push({ label: "SMS/source confirmation", value: 15 });
  if (input.mediaEvidence) factors.push({ label: "Photo/video evidence", value: 20 });
  if (input.gpsVerified) factors.push({ label: "GPS verified", value: 20 });
  if (input.multipleReports) factors.push({ label: "Multiple independent reports", value: 10 });
  const score = Math.min(
    100,
    Math.round(factors.reduce((sum, factor) => sum + factor.value, 0)),
  );
  return {
    score,
    label: score >= 80 ? "VERIFIED" : score >= 60 ? "HIGH CONFIDENCE" : score >= 40 ? "PARTIAL" : "LOW",
    factors,
  };
}

export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const radius = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * radius * Math.asin(Math.sqrt(h));
}

export function requiredResources(type: EmergencyType | string): ResourceType[] {
  return requirementMap[normalizeEmergencyType(type)];
}

export interface AllocationChoice {
  requiredType: ResourceType;
  resource: ResourceRecord;
  distanceKm: number;
  etaMin: number;
  score: number;
  crossZone: boolean;
  routeMode: "REAL ROUTING" | "ESTIMATED" | "SIMULATED WATER" | "STRAIGHT LINE";
}

export function allocateResources(
  incident: Pick<IncidentRecord, "type" | "lat" | "lng" | "zone"> & Partial<Pick<IncidentRecord, "assignedResourceIds">>,
  resources: ResourceRecord[],
) {
  const missing: ResourceType[] = [];
  const selected: AllocationChoice[] = [];
  const used = new Set<string>();
  const target = { lat: incident.lat, lng: incident.lng };

  for (const resourceType of requiredResources(incident.type)) {
    const candidates = resources
      .filter(
        (resource) => {
          const assignedHere = incident.assignedResourceIds?.includes(resource.id) ?? false;
          return (
            resource.type === resourceType &&
            (resource.status === "AVAILABLE" || assignedHere) &&
            !used.has(resource.id)
          );
        },
      )
      .map((resource) => {
        const distance = haversineKm(resource, target);
        const speed = resource.speed || speedByType[resource.type];
        const etaMin = Math.max(2, (distance / speed) * 60);
        return {
          requiredType: resourceType,
          resource,
          distanceKm: distance,
          etaMin,
          score: distance + etaMin * 0.5,
          crossZone: resource.zone !== incident.zone,
          routeMode:
            resource.type === "boat"
              ? "SIMULATED WATER"
              : resource.type === "drone"
                ? "STRAIGHT LINE"
                : "ESTIMATED",
        } satisfies AllocationChoice;
      })
      .sort((a, b) => a.score - b.score);

    const best = candidates[0];
    if (!best) {
      missing.push(resourceType);
    } else {
      selected.push(best);
      used.add(best.resource.id);
    }
  }

  return {
    selected,
    missing,
    averageEta:
      selected.length === 0
        ? 0
        : selected.reduce((sum, item) => sum + item.etaMin, 0) / selected.length,
  };
}

export function detectFusionCandidate(report: ReportRecord, incidents: IncidentRecord[]) {
  const reportPoint = { lat: report.lat, lng: report.lng };
  const reportTime = new Date(report.createdAt).getTime();
  return incidents.find((incident) => {
    const minutes = Math.abs(reportTime - new Date(incident.createdAt).getTime()) / 60000;
    const distance = haversineKm(reportPoint, incident);
    return (
      normalizeEmergencyType(incident.type) === normalizeEmergencyType(report.type) &&
      distance <= 1.5 &&
      minutes <= 30
    );
  });
}

export function fuseReportIntoIncident(report: ReportRecord, incidents: IncidentRecord[]) {
  const existing = detectFusionCandidate(report, incidents);
  if (!existing) {
    const incident: IncidentRecord = {
      id: `INC-${report.id.replace("REP-", "")}`,
      type: report.type,
      label: report.label,
      title: report.label,
      location: report.address,
      lat: report.lat,
      lng: report.lng,
      people: report.people,
      severityScore: report.severityScore,
      severityLevel: report.severityLevel,
      confidenceScore: report.confidenceScore,
      confidenceLabel: report.confidenceLabel,
      status: "NEW",
      createdAt: report.createdAt,
      reportIds: [report.id],
      evidence: [report.mediaEvidence ? "PHOTO + GPS" : "APP REPORT"],
      vulnerable: report.vulnerable,
      spreading: report.spreading,
      structuralDamage: report.structuralDamage,
      assignedResourceIds: [],
      zone: inferZone(report.lat, report.lng),
    };
    return { incident, incidents: [incident, ...incidents], fused: false };
  }

  const confidence = calculateConfidence({
    emergencyCall: existing.evidence.includes("CALL"),
    sms: existing.evidence.includes("SMS"),
    mediaEvidence: existing.evidence.includes("PHOTO + GPS") || report.mediaEvidence,
    gpsVerified: true,
    multipleReports: true,
  });
  const updated = {
    ...existing,
    people: Math.max(existing.people, report.people),
    severityScore: Math.max(existing.severityScore, report.severityScore),
    severityLevel: severityClass(Math.max(existing.severityScore, report.severityScore)),
    confidenceScore: confidence.score,
    confidenceLabel: confidence.label,
    reportIds: Array.from(new Set([...existing.reportIds, report.id])),
    evidence: Array.from(
      new Set([...existing.evidence, report.mediaEvidence ? "PHOTO + GPS" : "APP REPORT"]),
    ),
    vulnerable: existing.vulnerable || report.vulnerable,
    spreading: existing.spreading || report.spreading,
    structuralDamage: existing.structuralDamage || report.structuralDamage,
  };

  return {
    incident: updated,
    incidents: incidents.map((incident) => (incident.id === updated.id ? updated : incident)),
    fused: true,
  };
}

export function rankHospitals(incident: IncidentRecord, list: HospitalRecord[]) {
  return list
    .map((hospital) => {
      let capability =
        hospital.capacity.available * 0.5 + hospital.capacity.icuFree * 2;
      const specs = hospital.specializations;
      const type = normalizeEmergencyType(incident.type);
      if ((type === "fire" || type === "hazmat") && specs.includes("burns")) capability += 50;
      if ((type === "fire" || type === "hazmat") && specs.includes("trauma")) capability += 30;
      if (type === "flood") {
        if (specs.includes("general")) capability += 20;
        if (specs.includes("infectious")) capability += 40;
        capability += hospital.capacity.total * 0.1;
      }
      if (type === "collapse" || type === "accident") {
        if (specs.includes("trauma")) capability += 50;
        if (specs.includes("neuro")) capability += 30;
      }
      if (type === "medical") {
        if (specs.includes("cardiac")) capability += 30;
        if (specs.includes("general")) capability += 20;
      }
      if (hospital.status === "near_capacity") capability -= 40;
      if (hospital.status === "full") capability -= 100;
      const distance = haversineKm(incident, hospital);
      return {
        hospital,
        distanceKm: distance,
        score: Math.round(capability - distance * 5),
      };
    })
    .sort((a, b) => b.score - a.score);
}

export function scoreZone(zone: ZoneRecord) {
  const score = Math.round(
    zone.hazardSeverity * 0.45 +
      zone.exposure * 0.25 +
      zone.vulnerability * 0.15 +
      zone.accessRisk * 0.15,
  );
  const classification =
    score >= 75 ? "RED ZONE" : score >= 50 ? "HIGH RISK" : score >= 25 ? "WATCH" : "SAFE";
  return { score, classification };
}

export function vulnerableAtRisk(zone: ZoneRecord) {
  return zone.elderly + zone.children + zone.disabled + zone.medicalDependent;
}

export function remainingCapacity(shelter: ShelterRecord) {
  return Math.max(
    0,
    shelter.maximumCapacity - shelter.currentOccupancy - shelter.reservedCapacity,
  );
}

export function scoreShelters(zone: ZoneRecord, shelters: ShelterRecord[]) {
  const redZoneIds = new Set<string>([zone.id.replace("Z", "Zone ")]);
  return shelters
    .filter(
      (shelter) =>
        shelter.status !== "FULL" &&
        shelter.status !== "UNREACHABLE" &&
        !redZoneIds.has(shelter.zone),
    )
    .map((shelter) => {
      const capacityScore = Math.min(100, (remainingCapacity(shelter) / 500) * 100);
      const distance = haversineKm(zone, shelter);
      const distanceScore = Math.max(0, 100 - distance * 18);
      const score = Math.round(
        capacityScore * 0.4 +
          shelter.roadSafety * 0.25 +
          distanceScore * 0.2 +
          (shelter.medicalSupport ? 100 : 35) * 0.1 +
          (shelter.accessibleForDisabled ? 100 : 45) * 0.05,
      );
      return { shelter, score, distanceKm: distance, remaining: remainingCapacity(shelter) };
    })
    .sort((a, b) => b.score - a.score);
}

export function relocationPriority(zone: ZoneRecord) {
  const vulnerableFactor = Math.min(100, (vulnerableAtRisk(zone) / zone.population) * 170);
  const score = Math.round(
    zone.hazardSeverity * 0.4 +
      vulnerableFactor * 0.25 +
      zone.progression * 0.2 +
      zone.accessRisk * 0.15,
  );
  const classification =
    score >= 80 ? "IMMEDIATE" : score >= 60 ? "URGENT" : score >= 40 ? "PREPARE" : "MONITOR";
  return { score, classification };
}

export function buildRelocationPlan(
  zone: ZoneRecord,
  shelters: ShelterRecord[],
  resources: ResourceRecord[],
) {
  const ranked = scoreShelters(zone, shelters);
  let remaining = zone.population;
  const allocations: Array<{
    shelter: ShelterRecord;
    people: number;
    distanceKm: number;
    routeRisk: string;
  }> = [];

  for (const candidate of ranked) {
    if (remaining <= 0) break;
    const people = Math.min(remaining, candidate.remaining);
    if (people > 0) {
      allocations.push({
        shelter: candidate.shelter,
        people,
        distanceKm: candidate.distanceKm,
        routeRisk: candidate.shelter.roadSafety > 75 ? "safe route" : "detour advised",
      });
      remaining -= people;
    }
  }

  const busesAvailable = resources.filter((item) => item.type === "bus" && item.status === "AVAILABLE").length;
  const boatsAvailable = resources.filter((item) => item.type === "boat" && item.status === "AVAILABLE").length;
  const ambulancesAvailable = resources.filter((item) => item.type === "ambulance" && item.status === "AVAILABLE").length;
  const policeAvailable = resources.filter((item) => item.type === "police" && item.status === "AVAILABLE").length;
  const suggested = {
    buses: Math.ceil(zone.population / 45),
    ambulances: Math.max(1, Math.ceil(vulnerableAtRisk(zone) / 120)),
    police: Math.max(2, Math.ceil(zone.population / 250)),
    boats: zone.hazardSeverity > 70 ? 1 : 0,
  };

  return {
    rankedShelters: ranked,
    allocations,
    remainingPopulation: remaining,
    insufficient: remaining > 0,
    priority: relocationPriority(zone),
    suggested,
    availableTransport: {
      buses: busesAvailable,
      boats: boatsAvailable,
      ambulances: ambulancesAvailable,
      police: policeAvailable,
    },
  };
}

export function calculateZoneStress(
  zoneName: string,
  resources: ResourceRecord[],
  incidents: IncidentRecord[],
  assignments: AssignmentRecord[],
) {
  const zoneResources = resources.filter((resource) => resource.zone === zoneName);
  const total = zoneResources.length;
  const assigned = assignments.filter((assignment) => {
    const resource = resources.find((item) => item.id === assignment.resourceId);
    return resource?.zone === zoneName && assignment.status !== "RESOLVED";
  }).length;
  const unassignedIncidents = incidents.filter(
    (incident) =>
      incident.zone === zoneName &&
      incident.status !== "RESOLVED" &&
      incident.assignedResourceIds.length === 0,
  ).length;
  const score = total === 0 ? 100 : Math.min(100, Math.round(((assigned + unassignedIncidents) / total) * 100));
  const level = score >= 80 ? "CRITICAL" : score >= 50 ? "HIGH" : score >= 25 ? "ELEVATED" : "NORMAL";
  return { zoneName, total, assigned, unassignedIncidents, score, level };
}

export function cascadingRisks(incident: IncidentRecord, incidents: IncidentRecord[]) {
  const nearby = incidents.filter(
    (item) => item.id !== incident.id && haversineKm(incident, item) <= 5,
  );
  const risks: Array<{ level: "HIGH" | "MEDIUM"; title: string; advice: string }> = [];
  const type = normalizeEmergencyType(incident.type);
  if (type === "fire" && nearby.some((item) => normalizeEmergencyType(item.type) === "hazmat")) {
    risks.push({
      level: "HIGH",
      title: "Possible explosion",
      advice: "Fire is near chemical/hazmat activity. Recommend evacuation radius.",
    });
  }
  if (type === "flood") {
    risks.push({
      level: "MEDIUM",
      title: "Power outage risk",
      advice: "Pre-stage utility isolation team and backup lighting.",
    });
    risks.push({
      level: "MEDIUM",
      title: "Waterborne disease risk",
      advice: "Prioritize medical screening at receiving shelters.",
    });
  }
  if (type === "collapse" && nearby.length > 0) {
    risks.push({
      level: "HIGH",
      title: "Secondary collapse risk",
      advice: "Keep fire/rescue outside the debris exclusion boundary until cleared.",
    });
  }
  if (nearby.length >= 2) {
    risks.push({
      level: "HIGH",
      title: "Resource depletion / competition",
      advice: "Request mutual aid or pre-position spare units in adjacent zones.",
    });
  }
  return { nearbyCount: nearby.length, risks };
}

export function runSimulation(input: {
  type: EmergencyType;
  lat: number;
  lng: number;
  severity: number;
  toggles: Record<string, boolean>;
  resources: ResourceRecord[];
  incidents: IncidentRecord[];
  shelters: ShelterRecord[];
  zones: ZoneRecord[];
  hospitals: HospitalRecord[];
  assignments: AssignmentRecord[];
}) {
  const simResources = input.resources.map((resource) => ({ ...resource }));
  const simShelters = input.shelters.map((shelter) => ({ ...shelter }));
  const simHospitals = input.hospitals.map((hospital) => ({ ...hospital }));
  const notes: string[] = [];

  if (input.toggles.ambulanceUnavailable) {
    const ambulance = simResources.find((resource) => resource.type === "ambulance" && resource.status === "AVAILABLE");
    if (ambulance) ambulance.status = "OUT_OF_SERVICE";
    notes.push("One ambulance removed from availability.");
  }
  if (input.toggles.policeUnavailable) {
    const police = simResources.find((resource) => resource.type === "police" && resource.status === "AVAILABLE");
    if (police) police.status = "OUT_OF_SERVICE";
    notes.push("One police unit removed from availability.");
  }
  if (input.toggles.boatUnavailable) {
    const boat = simResources.find((resource) => resource.type === "boat" && resource.status === "AVAILABLE");
    if (boat) boat.status = "OUT_OF_SERVICE";
    notes.push("One rescue boat removed from availability.");
  }
  if (input.toggles.primaryShelterFull && simShelters[0]) {
    simShelters[0] = { ...simShelters[0], status: "FULL", currentOccupancy: simShelters[0].maximumCapacity };
    notes.push("Primary shelter forced to FULL.");
  }
  if (input.toggles.hospitalFull && simHospitals[0]) {
    simHospitals[0] = { ...simHospitals[0], status: "full", capacity: { ...simHospitals[0].capacity, available: 0, icuFree: 0 } };
    notes.push("Nearest hospital set to FULL.");
  }

  const zone = nearestZone(input.lat, input.lng, input.zones);
  const simulatedIncident: IncidentRecord = {
    id: "SIM-001",
    type: input.type,
    label: emergencyLabels[input.type],
    title: `${emergencyLabels[input.type]} simulation`,
    location: zone.name,
    lat: input.lat,
    lng: input.lng,
    people: Math.max(5, Math.round(input.severity / 3)),
    severityScore: input.severity,
    severityLevel: severityClass(input.severity),
    confidenceScore: 65,
    confidenceLabel: "RULE-BASED",
    status: "NEW",
    createdAt: new Date().toISOString(),
    reportIds: [],
    evidence: ["SIMULATED"],
    vulnerable: input.severity > 70,
    spreading: input.toggles.floodRise || input.toggles.redZoneExpand,
    structuralDamage: input.type === "collapse",
    assignedResourceIds: [],
    zone: zone.name.match(/Zone \d+/)?.[0] ?? zone.name,
    simulated: true,
  };
  const allocation = allocateResources(simulatedIncident, simResources);
  const stress = calculateZoneStress(
    simulatedIncident.zone,
    simResources,
    [...input.incidents, simulatedIncident],
    input.assignments,
  );
  const hospitalRanks = rankHospitals(simulatedIncident, simHospitals);
  const shelterRanks = scoreShelters(zone, simShelters);
  const cascade = cascadingRisks(simulatedIncident, input.incidents);
  const routeBlocked =
    input.toggles.roadCloses ||
    input.toggles.bridgeCloses ||
    input.toggles.routeBlocked ||
    input.toggles.redZoneExpand;
  const recommendations: Array<{ level: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW"; text: string }> = [];

  if (allocation.missing.length > 0) {
    recommendations.push({
      level: "CRITICAL",
      text: `Resource shortage: ${allocation.missing.join(", ")}. Request mutual aid.`,
    });
  }
  if (allocation.selected.some((item) => item.crossZone) || input.toggles.districtLoss) {
    recommendations.push({
      level: "HIGH",
      text: "Cross-zone deployment may create a coverage gap.",
    });
  }
  if (stress.score >= 70) {
    recommendations.push({
      level: "HIGH",
      text: "Affected zone is under stress. Pre-position spare resources.",
    });
  }
  if (allocation.averageEta > 15) {
    recommendations.push({
      level: "MEDIUM",
      text: "Delayed response. Consider closer staging / alternate support.",
    });
  }
  if (recommendations.length === 0) {
    recommendations.push({ level: "LOW", text: "Local response can handle this incident." });
  }
  if (routeBlocked) {
    recommendations.push({
      level: "MEDIUM",
      text: "Predicted road blockage. Use safe detour waypoint and alert traffic control.",
    });
  }
  if (input.toggles.powerOutage) {
    recommendations.push({
      level: "MEDIUM",
      text: "Power outage scenario: add drone survey and backup-lighting support.",
    });
  }
  if (input.toggles.anotherIncident) {
    recommendations.push({
      level: "HIGH",
      text: "Second incident added: expect dispatch competition and longer ETAs.",
    });
  }

  return {
    simulatedIncident,
    resources: simResources,
    shelters: simShelters,
    hospitals: simHospitals,
    allocation,
    stress,
    hospitalPriority: hospitalRanks[0],
    shelterPriority: shelterRanks[0],
    routeBlocked,
    cascading: cascade,
    recommendations,
    notes,
    canHandle:
      allocation.missing.length === 0 &&
      stress.score < 80 &&
      Boolean(hospitalRanks[0]) &&
      Boolean(shelterRanks[0]),
  };
}

export function nearestZone(lat: number, lng: number, zoneList: ZoneRecord[]) {
  return [...zoneList].sort(
    (a, b) => haversineKm({ lat, lng }, a) - haversineKm({ lat, lng }, b),
  )[0];
}

export function inferZone(lat: number, lng: number) {
  if (lat < 13.02 && lng < 80.24) return "Zone 4";
  if (lat < 13.04) return "Zone 5";
  if (lng > 80.27) return "Zone 7";
  return "Zone 2";
}

export function formatType(type: EmergencyType | ResourceType) {
  if (type in emergencyLabels) return emergencyLabels[type as EmergencyType];
  return type
    .split("_")
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ");
}
