"use client";

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  allocateResources,
  buildRelocationPlan,
  calculateConfidence,
  calculateSeverity,
  calculateZoneStress,
  cascadingRisks,
  formatType,
  fuseReportIntoIncident,
  haversineKm,
  rankHospitals,
  runSimulation,
  scoreZone,
  vulnerableAtRisk,
} from "./algorithms";

import {
  AssignmentRecord,
  EmergencyType,
  IncidentRecord,
  ReportRecord,
  ReportStage,
  ResourceRecord,
  ShelterRecord,
  ZoneRecord,
  demoIncident,
  emergencyLabels,
  hospitals,
  initialResources,
  initialShelters,
  roadHazards,
  zones,
} from "./data";

/* =========================================================
   TYPES
   ========================================================= */

type ViewMode =
  | "landing"
  | "report"
  | "track"
  | "command"
  | "responder"
  | "simulate"
  | "relocation";

type PersistPatch = {
  reports?: ReportRecord[];
  incidents?: IncidentRecord[];
  resources?: ResourceRecord[];
  assignments?: AssignmentRecord[];
  shelters?: ShelterRecord[];
};

interface AegisAppProps {
  view: ViewMode;
  reportId?: string;
}

interface ReportForm {
  type: EmergencyType;
  phone: string;
  people: number;
  vulnerableGroups: string[];
  spreading: boolean;
  structuralDamage: boolean;
  description: string;
  lat: string;
  lng: string;
  address: string;
  gpsVerified: boolean;
  mediaPreview?: string;
  error?: string;
  successId?: string;
}

/* =========================================================
   STORAGE
   ========================================================= */

const STORE = {
  reports: "aegis_reports",
  myReports: "my_reports",
  incidents: "aegis_incidents",
  resources: "aegis_resources",
  assignments: "aegis_assignments",
  shelters: "aegis_shelters",
} as const;

const REPORT_STAGES: ReportStage[] = [
  "Reported",
  "Acknowledged",
  "Dispatched",
  "On Scene",
  "Resolved",
];

/* =========================================================
   EMERGENCY META
   ========================================================= */

const TYPE_META: Record<
  EmergencyType,
  {
    code: string;
    hint: string;
  }
> = {
  fire: {
    code: "FIRE",
    hint: "Flames, smoke or active burning",
  },

  flood: {
    code: "FLOOD",
    hint: "Rising water, inundation or trapped people",
  },

  medical: {
    code: "MED",
    hint: "Injury, illness or immediate medical help",
  },

  accident: {
    code: "ROAD",
    hint: "Vehicle crash or road incident",
  },

  collapse: {
    code: "STRUCT",
    hint: "Building or structural failure",
  },

  hazmat: {
    code: "HAZ",
    hint: "Chemical leak, gas or hazardous material",
  },

  landslide: {
    code: "LAND",
    hint: "Slope failure, debris or blocked access",
  },

  cyclone: {
    code: "STORM",
    hint: "Severe wind, cyclone or weather damage",
  },

  other: {
    code: "OTHER",
    hint: "Any emergency not listed above",
  },
};

/* =========================================================
   WHAT IF TOGGLES
   ========================================================= */

const SIM_TOGGLES: Record<string, boolean> = {
  roadCloses: false,
  bridgeCloses: false,
  ambulanceUnavailable: false,
  policeUnavailable: false,
  boatUnavailable: false,
  hospitalFull: false,
  primaryShelterFull: false,
  floodRise: false,
  anotherIncident: false,
  powerOutage: false,
  redZoneExpand: false,
  routeBlocked: false,
  districtLoss: false,
};

/* =========================================================
   STORAGE HELPERS
   ========================================================= */

function storageGet<T>(
  key: string,
  fallback: T,
): T {
  try {
    const raw = localStorage.getItem(key);

    return raw
      ? (JSON.parse(raw) as T)
      : fallback;
  } catch {
    return fallback;
  }
}

function storageSet<T>(
  key: string,
  value: T,
) {
  try {
    localStorage.setItem(
      key,
      JSON.stringify(value),
    );
  } catch {
    // Keep prototype running if localStorage is full.
  }
}

function sameData(
  a: unknown,
  b: unknown,
) {
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function ageLabel(
  iso: string,
) {
  const mins = Math.max(
    0,
    Math.floor(
      (Date.now() -
        new Date(iso).getTime()) /
        60000,
    ),
  );

  if (mins < 1) {
    return "now";
  }

  if (mins < 60) {
    return `${mins}m`;
  }

  return `${Math.floor(mins / 60)}h`;
}

function statusTone(
  value: string,
) {
  const v = value.toLowerCase();

  if (
    v.includes("critical") ||
    v.includes("red") ||
    v.includes("full") ||
    v.includes("blocked")
  ) {
    return "danger";
  }

  if (
    v.includes("high") ||
    v.includes("urgent") ||
    v.includes("limited") ||
    v.includes("constrained")
  ) {
    return "warn";
  }

  if (
    v.includes("available") ||
    v.includes("safe") ||
    v.includes("normal") ||
    v.includes("resolved")
  ) {
    return "ok";
  }

  return "neutral";
}

function defaultForm(): ReportForm {
  return {
    type: "flood",
    phone: "",
    people: 1,
    vulnerableGroups: [],
    spreading: false,
    structuralDamage: false,
    description: "",
    lat: "",
    lng: "",
    address: "",
    gpsVerified: false,
  };
}

/* =========================================================
   SANITIZE LOCAL STATE
   ========================================================= */

function sanitizeState(
  input: {
    reports: ReportRecord[];
    incidents: IncidentRecord[];
    resources: ResourceRecord[];
    assignments: AssignmentRecord[];
  },
) {
  const reportIds = new Set(
    input.reports.map(
      (report) => report.id,
    ),
  );

  const incidents =
    input.incidents.filter(
      (incident) =>
        incident.simulated ||
        incident.reportIds.length === 0 ||
        incident.reportIds.some(
          (id) => reportIds.has(id),
        ),
    );

  const incidentIds = new Set(
    incidents.map(
      (incident) => incident.id,
    ),
  );

  const assignments =
    input.assignments.filter(
      (assignment) =>
        incidentIds.has(
          assignment.incidentId,
        ),
    );

  return {
    reports: input.reports,
    incidents,
    resources: input.resources,
    assignments,
  };
}

/* =========================================================
   MAIN APP
   ========================================================= */

export default function AegisApp({
  view,
  reportId,
}: AegisAppProps) {
  const [
    reports,
    setReports,
  ] = useState<ReportRecord[]>([]);

  const [
    incidents,
    setIncidents,
  ] = useState<IncidentRecord[]>([]);

  const [
    resources,
    setResources,
  ] = useState<ResourceRecord[]>(
    initialResources,
  );

  const [
    assignments,
    setAssignments,
  ] = useState<AssignmentRecord[]>([]);

  const [
    shelters,
    setShelters,
  ] = useState<ShelterRecord[]>(
    initialShelters,
  );

  /*
   * IMPORTANT:
   *
   * This timestamp prevents an OLD persisted EN_ROUTE
   * assignment from automatically moving a vehicle after
   * the app is refreshed.
   *
   * Only assignments CREATED or UPDATED after the current
   * browser session started are permitted to move.
   */

  const sessionStartedAtRef =
    useRef(Date.now());

  /* =======================================================
     INITIAL LOCAL STORAGE LOAD
     ======================================================= */

  useEffect(() => {
    const state =
      sanitizeState({
        reports:
          storageGet(
            STORE.reports,
            [],
          ),

        incidents:
          storageGet(
            STORE.incidents,
            [],
          ),

        resources:
          storageGet(
            STORE.resources,
            initialResources,
          ),

        assignments:
          storageGet(
            STORE.assignments,
            [],
          ),
      });

    setReports(
      state.reports,
    );

    setIncidents(
      state.incidents,
    );

    setResources(
      state.resources,
    );

    setAssignments(
      state.assignments,
    );

    setShelters(
      storageGet(
        STORE.shelters,
        initialShelters,
      ),
    );
  }, []);

  /* =======================================================
     CROSS-PAGE SYNC
     ======================================================= */

  useEffect(() => {
    const timer =
      window.setInterval(
        () => {
          const state =
            sanitizeState({
              reports:
                storageGet(
                  STORE.reports,
                  [],
                ),

              incidents:
                storageGet(
                  STORE.incidents,
                  [],
                ),

              resources:
                storageGet(
                  STORE.resources,
                  initialResources,
                ),

              assignments:
                storageGet(
                  STORE.assignments,
                  [],
                ),
            });

          const storedShelters =
            storageGet(
              STORE.shelters,
              initialShelters,
            );

          setReports(
            (current) =>
              sameData(
                current,
                state.reports,
              )
                ? current
                : state.reports,
          );

          setIncidents(
            (current) =>
              sameData(
                current,
                state.incidents,
              )
                ? current
                : state.incidents,
          );

          setResources(
            (current) =>
              sameData(
                current,
                state.resources,
              )
                ? current
                : state.resources,
          );

          setAssignments(
            (current) =>
              sameData(
                current,
                state.assignments,
              )
                ? current
                : state.assignments,
          );

          setShelters(
            (current) =>
              sameData(
                current,
                storedShelters,
              )
                ? current
                : storedShelters,
          );
        },
        1500,
      );

    return () =>
      window.clearInterval(
        timer,
      );
  }, []);

  /* =======================================================
     RESOURCE MOVEMENT ENGINE

     RULE:
     Old localStorage assignment = NO automatic movement.

     New Command Center dispatch = movement.

     Assigned vehicles only = movement.

     Unassigned vehicles = remain stationary.
     ======================================================= */

  useEffect(() => {
    const sessionStartedAt =
      sessionStartedAtRef.current;

    const moving =
      assignments.filter(
        (assignment) => {
          if (
            ![
              "ASSIGNED",
              "ACCEPTED",
              "EN_ROUTE",
            ].includes(
              assignment.status,
            )
          ) {
            return false;
          }

          const createdAt =
            new Date(
              assignment.createdAt,
            ).getTime();

          const updatedAt =
            new Date(
              assignment.updatedAt,
            ).getTime();

          const activatedAt =
            Math.max(
              Number.isFinite(
                createdAt,
              )
                ? createdAt
                : 0,

              Number.isFinite(
                updatedAt,
              )
                ? updatedAt
                : 0,
            );

          return (
            activatedAt >=
            sessionStartedAt
          );
        },
      );

    if (
      moving.length === 0
    ) {
      return;
    }

    const timer =
      window.setInterval(
        () => {
          const byResource =
            new Map(
              moving.map(
                (assignment) => [
                  assignment.resourceId,
                  assignment,
                ],
              ),
            );

          const arrivedAssignments =
            new Set<string>();

          const arrivedIncidents =
            new Set<string>();

          setResources(
            (currentResources) => {
              const nextResources =
                currentResources.map(
                  (resource) => {
                    const assignment =
                      byResource.get(
                        resource.id,
                      );

                    if (
                      !assignment
                    ) {
                      return resource;
                    }

                    const incident =
                      incidents.find(
                        (item) =>
                          item.id ===
                          assignment.incidentId,
                      );

                    if (
                      !incident
                    ) {
                      return resource;
                    }

                    const distance =
                      haversineKm(
                        resource,
                        incident,
                      );

                    if (
                      distance <=
                      0.035
                    ) {
                      arrivedAssignments.add(
                        assignment.id,
                      );

                      arrivedIncidents.add(
                        incident.id,
                      );

                      return {
                        ...resource,

                        lat:
                          incident.lat,

                        lng:
                          incident.lng,

                        status:
                          "ON_SCENE" as const,
                      };
                    }

                    /*
                     * Demo movement.
                     *
                     * This changes the unit's canonical coordinates.
                     * Leaflet performs an additional visual interpolation.
                     */

                    const factor =
                      resource.type ===
                      "drone"
                        ? 0.065

                        : resource.type ===
                            "boat"
                          ? 0.028

                          : 0.043;

                    return {
                      ...resource,

                      lat:
                        resource.lat +
                        (
                          incident.lat -
                          resource.lat
                        ) *
                          factor,

                      lng:
                        resource.lng +
                        (
                          incident.lng -
                          resource.lng
                        ) *
                          factor,

                      status:
                        "EN_ROUTE" as const,
                    };
                  },
                );

              if (
                !sameData(
                  currentResources,
                  nextResources,
                )
              ) {
                storageSet(
                  STORE.resources,
                  nextResources,
                );
              }

              return nextResources;
            },
          );

          /*
           * Update tracking when a resource reaches scene.
           */

          if (
            arrivedAssignments.size >
            0
          ) {
            const time =
              nowIso();

            setAssignments(
              (
                currentAssignments,
              ) => {
                const nextAssignments =
                  currentAssignments.map(
                    (assignment) =>
                      arrivedAssignments.has(
                        assignment.id,
                      )
                        ? {
                            ...assignment,

                            status:
                              "ON_SCENE" as const,

                            updatedAt:
                              time,
                          }

                        : assignment,
                  );

                storageSet(
                  STORE.assignments,
                  nextAssignments,
                );

                return nextAssignments;
              },
            );

            setIncidents(
              (
                currentIncidents,
              ) => {
                const nextIncidents =
                  currentIncidents.map(
                    (incident) =>
                      arrivedIncidents.has(
                        incident.id,
                      )
                        ? {
                            ...incident,

                            status:
                              "ON_SCENE" as const,
                          }

                        : incident,
                  );

                storageSet(
                  STORE.incidents,
                  nextIncidents,
                );

                return nextIncidents;
              },
            );

            setReports(
              (
                currentReports,
              ) => {
                const nextReports =
                  currentReports.map(
                    (report) =>
                      arrivedIncidents.has(
                        report.incidentId,
                      )
                        ? {
                            ...report,

                            status:
                              "On Scene" as const,
                          }

                        : report,
                  );

                storageSet(
                  STORE.reports,
                  nextReports,
                );

                return nextReports;
              },
            );
          }
        },
        180,
      );

    return () =>
      window.clearInterval(
        timer,
      );
  }, [
    assignments,
    incidents,
  ]);

  /* =======================================================
     CENTRAL PERSIST
     ======================================================= */

  function persist(
    patch: PersistPatch,
  ) {
    if (
      patch.reports
    ) {
      setReports(
        patch.reports,
      );

      storageSet(
        STORE.reports,
        patch.reports,
      );

      storageSet(
        STORE.myReports,

        patch.reports.map(
          (report) =>
            report.id,
        ),
      );
    }

    if (
      patch.incidents
    ) {
      setIncidents(
        patch.incidents,
      );

      storageSet(
        STORE.incidents,
        patch.incidents,
      );
    }

    if (
      patch.resources
    ) {
      setResources(
        patch.resources,
      );

      storageSet(
        STORE.resources,
        patch.resources,
      );
    }

    if (
      patch.assignments
    ) {
      setAssignments(
        patch.assignments,
      );

      storageSet(
        STORE.assignments,
        patch.assignments,
      );
    }

    if (
      patch.shelters
    ) {
      setShelters(
        patch.shelters,
      );

      storageSet(
        STORE.shelters,
        patch.shelters,
      );
    }
  }

  /* =======================================================
     ROUTES
     ======================================================= */

  return (
    <div className="aegis-root">

      <style>
        {APP_CSS}
      </style>

      <TopNav
        view={view}
      />

      {view ===
        "landing" && (
        <Landing />
      )}

      {view ===
        "report" && (
        <ReportPage
          reports={
            reports
          }
          incidents={
            incidents
          }
          persist={
            persist
          }
        />
      )}

      {view ===
        "track" && (
        <TrackPage
          reportId={
            reportId
          }
          reports={
            reports
          }
        />
      )}

      {view ===
        "command" && (
        <CommandPage
          reports={
            reports
          }
          incidents={
            incidents
          }
          resources={
            resources
          }
          assignments={
            assignments
          }
          shelters={
            shelters
          }
          persist={
            persist
          }
        />
      )}

      {view ===
        "responder" && (
        <ResponderPage
          reports={
            reports
          }
          incidents={
            incidents
          }
          resources={
            resources
          }
          assignments={
            assignments
          }
          persist={
            persist
          }
        />
      )}

      {view ===
        "simulate" && (
        <SimulatorPage
          incidents={
            incidents
          }
          resources={
            resources
          }
          assignments={
            assignments
          }
          shelters={
            shelters
          }
        />
      )}

      {view ===
        "relocation" && (
        <RelocationPage
          resources={
            resources
          }
          shelters={
            shelters
          }
          persist={
            persist
          }
        />
      )}

    </div>
  );
}

/* =========================================================
   TOP NAV
   ========================================================= */

function TopNav({
  view,
}: {
  view: ViewMode;
}) {
  const links: Array<
    [
      ViewMode,
      string,
      string,
    ]
  > = [
    [
      "command",
      "Command",
      "/command",
    ],

    [
      "report",
      "Report",
      "/report",
    ],

    [
      "responder",
      "Responder",
      "/responder",
    ],

    [
      "simulate",
      "What-If",
      "/simulate",
    ],

    [
      "relocation",
      "Relocation",
      "/relocation",
    ],
  ];

  return (
    <header className="ops-nav">

      <a
        className="brand"
        href="/command"
      >

        <span className="brand-mark">
          <i />
          <i />
          <i />
        </span>

        <span>

          <b>
            AEGIS
          </b>

          <small>
            Emergency Coordination / PSS3
          </small>

        </span>

      </a>

      <nav>

        {links.map(
          ([
            key,
            label,
            href,
          ]) => (

            <a
              key={
                key
              }
              href={
                href
              }
              className={
                view ===
                key
                  ? "active"
                  : ""
              }
            >
              {label}
            </a>

          ),
        )}

      </nav>

      <div className="live">
        <i />
        LOCAL DEMO
      </div>

    </header>
  );
}

/* =========================================================
   LANDING
   ========================================================= */

function Landing() {
  return (
    <main className="landing">

      <section className="hero">

        <span className="eyebrow">
          PSS3 / INTELLIGENT EMERGENCY RESPONSE COORDINATION
        </span>

        <h1>
          One operational picture.
          <br />
          Before the next emergency.
        </h1>

        <p>
          AEGIS turns citizen reports into incident priority,
          resource choices, routes, hospital recommendations,
          red-zone intelligence and relocation decisions.
        </p>

        <div className="flow">

          <span>
            REPORT
          </span>

          <i />

          <span>
            FUSE
          </span>

          <i />

          <span>
            PRIORITIZE
          </span>

          <i />

          <span>
            DISPATCH
          </span>

          <i />

          <span>
            PREDICT
          </span>

          <i />

          <span>
            RELOCATE
          </span>

        </div>

      </section>

      <section className="role-grid">

        <Role
          href="/report"
          code="01 / PUBLIC"
          title="Report an emergency"
          text="Fast citizen intake, GPS, evidence and tracking."
          light
        />

        <Role
          href="/command"
          code="02 / CONTROL"
          title="Command Center"
          text="Incident priority, operational map and dispatch."
        />

        <Role
          href="/responder"
          code="03 / FIELD"
          title="Responder channel"
          text="Assignments, location and field status."
        />

        <Role
          href="/relocation"
          code="04 / PLANNING"
          title="Risk & relocation"
          text="Red zones, shelter capacity and evacuation."
        />

      </section>

    </main>
  );
}

function Role({
  href,
  code,
  title,
  text,
  light,
}: {
  href: string;
  code: string;
  title: string;
  text: string;
  light?: boolean;
}) {
  return (
    <a
      href={href}
      className={
        `role ${
          light
            ? "light"
            : ""
        }`
      }
    >

      <small>
        {code}
      </small>

      <b>
        {title}
      </b>

      <span>
        {text}
      </span>

    </a>
  );
}

/* =========================================================
   REPORT PAGE
   ========================================================= */

function ReportPage({
  reports,
  incidents,
  persist,
}: {
  reports: ReportRecord[];
  incidents: IncidentRecord[];
  persist: (
    p: PersistPatch,
  ) => void;
}) {
  const [
    form,
    setForm,
  ] =
    useState<ReportForm>(
      defaultForm(),
    );

  const [
    locating,
    setLocating,
  ] =
    useState(false);

  const [
    searching,
    setSearching,
  ] =
    useState(false);

  const [
    submitted,
    setSubmitted,
  ] =
    useState<
      ReportRecord | null
    >(null);

  const severity =
    calculateSeverity({
      type:
        form.type,

      people:
        form.people,

      vulnerable:
        form.vulnerableGroups.length >
        0,

      structuralDamage:
        form.structuralDamage,

      spreading:
        form.spreading,

      mediaEvidence:
        Boolean(
          form.mediaPreview,
        ),
    });

  const confidence =
    calculateConfidence({
      mediaEvidence:
        Boolean(
          form.mediaPreview,
        ),

      gpsVerified:
        form.gpsVerified,
    });

  function set<
    K extends keyof ReportForm,
  >(
    key: K,
    value: ReportForm[K],
  ) {
    setForm(
      (current) => ({
        ...current,

        [key]:
          value,

        error:
          undefined,
      }),
    );
  }

  function toggleGroup(
    group: string,
  ) {
    setForm(
      (current) => ({
        ...current,

        vulnerableGroups:
          current.vulnerableGroups.includes(
            group,
          )
            ? current.vulnerableGroups.filter(
                (item) =>
                  item !==
                  group,
              )

            : [
                ...current.vulnerableGroups,
                group,
              ],
      }),
    );
  }

  /* =======================================================
     GPS
     ======================================================= */

  function useGps() {
    if (
      !navigator.geolocation
    ) {
      set(
        "error",
        "GPS is not available in this browser.",
      );

      return;
    }

    setLocating(
      true,
    );

    navigator.geolocation
      .getCurrentPosition(

        async (
          position,
        ) => {
          const lat =
            position.coords.latitude;

          const lng =
            position.coords.longitude;

          let address =
            `GPS ${lat.toFixed(
              5,
            )}, ${lng.toFixed(
              5,
            )}`;

          try {
            const response =
              await fetch(
                `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}`,
              );

            const data =
              (await response.json()) as {
                display_name?: string;
              };

            if (
              data.display_name
            ) {
              address =
                data.display_name;
            }
          } catch {
            // Coordinate fallback.
          }

          setForm(
            (current) => ({
              ...current,

              lat:
                lat.toFixed(
                  6,
                ),

              lng:
                lng.toFixed(
                  6,
                ),

              address,

              gpsVerified:
                true,

              error:
                undefined,
            }),
          );

          setLocating(
            false,
          );
        },

        () => {
          setLocating(
            false,
          );

          set(
            "error",
            "GPS permission denied. Search an address or enter coordinates.",
          );
        },

        {
          enableHighAccuracy:
            true,

          timeout:
            9000,
        },
      );
  }

  /* =======================================================
     ADDRESS SEARCH
     ======================================================= */

  async function findAddress() {
    if (
      !form.address.trim()
    ) {
      set(
        "error",
        "Type an address or landmark first.",
      );

      return;
    }

    setSearching(
      true,
    );

    try {
      const response =
        await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
            form.address,
          )}&limit=1`,
        );

      const data =
        (await response.json()) as Array<{
          lat: string;
          lon: string;
          display_name: string;
        }>;

      if (
        !data[0]
      ) {
        throw new Error(
          "No location found",
        );
      }

      setForm(
        (current) => ({
          ...current,

          lat:
            Number(
              data[0].lat,
            ).toFixed(
              6,
            ),

          lng:
            Number(
              data[0].lon,
            ).toFixed(
              6,
            ),

          address:
            data[0].display_name,

          gpsVerified:
            false,

          error:
            undefined,
        }),
      );
    } catch {
      set(
        "error",
        "Address search failed. Enter coordinates manually if needed.",
      );
    } finally {
      setSearching(
        false,
      );
    }
  }

  /* =======================================================
     IMAGE
     ======================================================= */

  function addImage(
    file?: File,
  ) {
    if (
      !file
    ) {
      return;
    }

    const reader =
      new FileReader();

    reader.onload =
      () => {
        const image =
          new Image();

        image.onload =
          () => {
            const scale =
              Math.min(
                1,

                800 /
                  Math.max(
                    image.width,
                    image.height,
                  ),
              );

            const canvas =
              document.createElement(
                "canvas",
              );

            canvas.width =
              Math.round(
                image.width *
                  scale,
              );

            canvas.height =
              Math.round(
                image.height *
                  scale,
              );

            const context =
              canvas.getContext(
                "2d",
              );

            if (
              !context
            ) {
              return;
            }

            context.drawImage(
              image,
              0,
              0,
              canvas.width,
              canvas.height,
            );

            set(
              "mediaPreview",

              canvas.toDataURL(
                "image/jpeg",
                0.7,
              ),
            );
          };

        if (
          typeof reader.result ===
          "string"
        ) {
          image.src =
            reader.result;
        }
      };

    reader.readAsDataURL(
      file,
    );
  }

  /* =======================================================
     SUBMIT REPORT

     IMPORTANT:
     Submitting creates the report/incident.

     It DOES NOT randomly move emergency resources.

     Resource movement starts only after an actual Command
     Center dispatch creates fresh assignments.
     ======================================================= */

  function submit() {
    const lat =
      Number(
        form.lat,
      );

    const lng =
      Number(
        form.lng,
      );

    if (
      !/^\d{10}$/.test(
        form.phone,
      )
    ) {
      set(
        "error",
        "Enter a valid 10-digit phone number.",
      );

      return;
    }

    if (
      !Number.isFinite(
        lat,
      ) ||
      !Number.isFinite(
        lng,
      ) ||
      Math.abs(
        lat,
      ) >
        90 ||
      Math.abs(
        lng,
      ) >
        180
    ) {
      set(
        "error",
        "A valid emergency location is required.",
      );

      return;
    }

    const id =
      `REP-${Date.now()}`;

    const report: ReportRecord = {
      id,

      incidentId:
        "",

      type:
        severity.type,

      label:
        emergencyLabels[
          severity.type
        ],

      phone:
        form.phone,

      people:
        form.people,

      vulnerable:
        form.vulnerableGroups.length >
        0,

      vulnerableGroups:
        form.vulnerableGroups,

      spreading:
        form.spreading,

      structuralDamage:
        form.structuralDamage,

      description:
        form.description,

      mediaEvidence:
        Boolean(
          form.mediaPreview,
        ),

      mediaPreview:
        form.mediaPreview,

      lat,
      lng,

      address:
        form.address ||
        `${lat.toFixed(
          5,
        )}, ${lng.toFixed(
          5,
        )}`,

      createdAt:
        nowIso(),

      source:
        "app",

      gpsVerified:
        form.gpsVerified,

      severityScore:
        severity.score,

      severityLevel:
        severity.level,

      confidenceScore:
        confidence.score,

      confidenceLabel:
        confidence.label,

      status:
        "Reported",
    };

    const fused =
      fuseReportIntoIncident(
        report,
        incidents,
      );

    report.incidentId =
      fused.incident.id;

    persist({
      reports: [
        report,
        ...reports,
      ],

      incidents:
        fused.incidents,
    });

    setSubmitted(
      report,
    );

    setForm({
      ...defaultForm(),

      successId:
        id,
    });
  }

  /* =======================================================
     SUCCESS
     ======================================================= */

  if (
    form.successId
  ) {
    const report =
      submitted ??
      reports.find(
        (item) =>
          item.id ===
          form.successId,
      );

    return (
      <main className="receipt-wrap">

        <section className="receipt">

          <header>

            <span className="check">
              ✓
            </span>

            <b>
              REPORT RECEIVED
            </b>

            <small>
              AEGIS / PUBLIC INTAKE
            </small>

          </header>

          <div className="receipt-main">

            <p>
              Keep this reference number
            </p>

            <h1>
              {form.successId}
            </h1>

            <span>
              Your report has entered the AEGIS
              emergency-coordination workflow.
            </span>

          </div>

          <div className="receipt-grid">

            <Fact
              label="Emergency"
              value={
                report?.label ??
                "Emergency"
              }
            />

            <Fact
              label="Priority"
              value={
                `${
                  report?.severityLevel ??
                  "—"
                } · ${
                  report?.severityScore ??
                  0
                }/100`
              }
            />

            <Fact
              label="Location"
              value={
                report?.address ??
                "Recorded"
              }
            />

            <Fact
              label="Time"
              value={
                new Date(
                  report?.createdAt ??
                    Date.now(),
                ).toLocaleString()
              }
            />

          </div>

          <div className="public-warning">
            Prototype only — this demo is not connected to
            official government emergency dispatch.
          </div>

          <footer>

            <a
              className="primary"
              href={`/track/${form.successId}`}
            >
              Track this report
            </a>

            <button
              onClick={() => {
                setSubmitted(
                  null,
                );

                setForm(
                  defaultForm(),
                );
              }}
            >
              Submit another
            </button>

          </footer>

        </section>

      </main>
    );
  }

  const demoAreas: Record<
    string,
    [
      string,
      string,
      string,
    ]
  > = {
    "Riverside Bridge": [
      "13.0124",
      "80.2268",
      "Zone 4 – Riverside Bridge, Chennai",
    ],

    "Canal East": [
      "13.0260",
      "80.2390",
      "Zone 5 – Canal East, Chennai",
    ],

    "Market Junction": [
      "13.0500",
      "80.2670",
      "Zone 2 – Market Junction, Chennai",
    ],

    "Industrial Edge": [
      "13.0730",
      "80.2860",
      "Zone 7 – Industrial Edge, Chennai",
    ],
  };

  return (
    <main className="public-page">

      <section className="public-head">

        <div className="public-kicker">

          <span>
            AEGIS / PUBLIC INTAKE
          </span>

          <span>
            Emergency report
          </span>

        </div>

        <div className="public-title">

          <div>

            <h1>
              Tell us what’s happening.
            </h1>

            <p>
              Location and people at risk matter most.
              Add only what you know and only when it is safe.
            </p>

          </div>

          <div className="prototype-note">

            <b>
              Prototype channel
            </b>

            <span>
              Not connected to official emergency dispatch.
            </span>

          </div>

        </div>

        <div className="step-rail">

          <span>
            <b>01</b>
            Incident
          </span>

          <span>
            <b>02</b>
            People
          </span>

          <span>
            <b>03</b>
            Location
          </span>

          <span>
            <b>04</b>
            Details
          </span>

        </div>

      </section>

      <div className="public-layout">

        <section className="public-form">

          {form.error && (
            <div className="form-error">
              {form.error}
            </div>
          )}

          <FormSection
            n="01"
            title="What happened?"
            hint="Choose the closest emergency type."
          >

            <div className="type-grid">

              {(
                Object.entries(
                  emergencyLabels,
                ) as Array<
                  [
                    EmergencyType,
                    string,
                  ]
                >
              ).map(
                ([
                  key,
                  label,
                ]) => (

                  <button
                    key={
                      key
                    }
                    type="button"
                    className={
                      `type-card ${
                        form.type ===
                        key
                          ? "selected"
                          : ""
                      }`
                    }
                    onClick={() =>
                      set(
                        "type",
                        key,
                      )
                    }
                  >

                    <small>
                      {
                        TYPE_META[
                          key
                        ].code
                      }
                    </small>

                    <b>
                      {label}
                    </b>

                    <span>
                      {
                        TYPE_META[
                          key
                        ].hint
                      }
                    </span>

                    <i>
                      {
                        form.type ===
                        key
                          ? "SELECTED"
                          : "SELECT"
                      }
                    </i>

                  </button>

                ),
              )}

            </div>

          </FormSection>

          <FormSection
            n="02"
            title="Who needs help?"
            hint="Help responders understand the scale."
          >

            <div className="field-grid two">

              <label>

                <span>
                  Phone number
                </span>

                <input
                  inputMode="numeric"
                  placeholder="10-digit mobile number"
                  value={
                    form.phone
                  }
                  onChange={
                    (
                      event,
                    ) =>
                      set(
                        "phone",

                        event.target.value
                          .replace(
                            /\D/g,
                            "",
                          )
                          .slice(
                            0,
                            10,
                          ),
                      )
                  }
                />

              </label>

              <label>

                <span>
                  People in danger
                </span>

                <div className="counter">

                  <button
                    type="button"
                    onClick={() =>
                      set(
                        "people",

                        Math.max(
                          0,
                          form.people -
                            1,
                        ),
                      )
                    }
                  >
                    −
                  </button>

                  <input
                    type="number"
                    min="0"
                    value={
                      form.people
                    }
                    onChange={
                      (
                        event,
                      ) =>
                        set(
                          "people",

                          Math.max(
                            0,

                            Number(
                              event.target.value,
                            ) ||
                              0,
                          ),
                        )
                    }
                  />

                  <button
                    type="button"
                    onClick={() =>
                      set(
                        "people",

                        form.people +
                          1,
                      )
                    }
                  >
                    +
                  </button>

                </div>

              </label>

            </div>

            <div className="mini-label">

              <b>
                Anyone especially vulnerable?
              </b>

              <span>
                Select all that apply
              </span>

            </div>

            <div className="chips">

              {[
                "elderly",
                "children",
                "disabled",
                "medical support",
              ].map(
                (
                  group,
                ) => (

                  <button
                    type="button"
                    key={
                      group
                    }
                    onClick={() =>
                      toggleGroup(
                        group,
                      )
                    }
                    className={
                      form.vulnerableGroups.includes(
                        group,
                      )
                        ? "active"
                        : ""
                    }
                  >
                    {group}
                  </button>

                ),
              )}

            </div>

            <div className="condition-grid">

              <button
                type="button"
                className={
                  form.spreading
                    ? "active"
                    : ""
                }
                onClick={() =>
                  set(
                    "spreading",

                    !form.spreading,
                  )
                }
              >

                <i>
                  {
                    form.spreading
                      ? "✓"
                      : ""
                  }
                </i>

                <span>

                  <b>
                    Situation is getting worse
                  </b>

                  <small>
                    Fire, water or hazard is spreading.
                  </small>

                </span>

              </button>

              <button
                type="button"
                className={
                  form.structuralDamage
                    ? "active"
                    : ""
                }
                onClick={() =>
                  set(
                    "structuralDamage",

                    !form.structuralDamage,
                  )
                }
              >

                <i>
                  {
                    form.structuralDamage
                      ? "✓"
                      : ""
                  }
                </i>

                <span>

                  <b>
                    Structural damage
                  </b>

                  <small>
                    Building, bridge or structure is damaged.
                  </small>

                </span>

              </button>

            </div>

          </FormSection>

          <FormSection
            n="03"
            title="Where is the emergency?"
            hint="GPS is fastest. A landmark works when GPS fails."
          >

            <div className="loc-row">

              <button
                type="button"
                className="gps"
                onClick={
                  useGps
                }
              >

                <span className="target" />

                <span>

                  <b>
                    {
                      locating
                        ? "Finding location…"
                        : "Use my current location"
                    }
                  </b>

                  <small>
                    {
                      form.gpsVerified
                        ? "GPS verified"
                        : "Browser/device GPS"
                    }
                  </small>

                </span>

              </button>

              <button
                type="button"
                className="find"
                onClick={
                  findAddress
                }
                disabled={
                  searching
                }
              >
                {
                  searching
                    ? "Searching…"
                    : "Find address"
                }
              </button>

            </div>

            <label className="full-field">

              <span>
                Address or nearby landmark
              </span>

              <input
                value={
                  form.address
                }
                onChange={
                  (
                    event,
                  ) =>
                    set(
                      "address",

                      event.target.value,
                    )
                }
                placeholder="Example: bus stand near Riverside Bridge"
              />

            </label>

            <label className="full-field">

              <span>
                Demo area shortcut
              </span>

              <select
                defaultValue=""
                onChange={
                  (
                    event,
                  ) => {
                    const preset =
                      demoAreas[
                        event.target.value
                      ];

                    if (
                      preset
                    ) {
                      setForm(
                        (
                          current,
                        ) => ({
                          ...current,

                          lat:
                            preset[0],

                          lng:
                            preset[1],

                          address:
                            preset[2],

                          gpsVerified:
                            false,

                          error:
                            undefined,
                        }),
                      );
                    }
                  }
                }
              >

                <option value="">
                  Select a demo area
                </option>

                {Object.keys(
                  demoAreas,
                ).map(
                  (
                    name,
                  ) => (

                    <option
                      key={
                        name
                      }
                    >
                      {name}
                    </option>

                  ),
                )}

              </select>

            </label>

            <details className="coords">

              <summary>
                Enter coordinates manually
              </summary>

              <div className="field-grid two">

                <label>

                  <span>
                    Latitude
                  </span>

                  <input
                    value={
                      form.lat
                    }
                    onChange={
                      (
                        event,
                      ) =>
                        set(
                          "lat",

                          event.target.value,
                        )
                    }
                    placeholder="13.0124"
                  />

                </label>

                <label>

                  <span>
                    Longitude
                  </span>

                  <input
                    value={
                      form.lng
                    }
                    onChange={
                      (
                        event,
                      ) =>
                        set(
                          "lng",

                          event.target.value,
                        )
                    }
                    placeholder="80.2268"
                  />

                </label>

              </div>

            </details>

          </FormSection>

          <FormSection
            n="04"
            title="Add useful details"
            hint="Optional. Only add evidence if it is safe."
          >

            <label className="full-field">

              <span>
                What should responders know?
              </span>

              <textarea
                value={
                  form.description
                }
                onChange={
                  (
                    event,
                  ) =>
                    set(
                      "description",

                      event.target.value,
                    )
                }
                placeholder="Example: two people are trapped in a car; water is still rising."
              />

            </label>

            <label className="upload">

              <input
                type="file"
                accept="image/*"
                onChange={
                  (
                    event,
                  ) =>
                    addImage(
                      event.target.files?.[
                        0
                      ],
                    )
                }
              />

              <b>
                +
              </b>

              <span>

                <strong>
                  {
                    form.mediaPreview
                      ? "Replace photo"
                      : "Add a photo"
                  }
                </strong>

                <small>
                  Compressed before being stored in this browser.
                </small>

              </span>

            </label>

            {form.mediaPreview && (

              <img
                className="preview"
                src={
                  form.mediaPreview
                }
                alt="Emergency evidence preview"
              />

            )}

          </FormSection>

          <div className="submit-row">

            <span>

              <b>
                Ready to send?
              </b>

              <small>
                Review the phone number and location first.
              </small>

            </span>

            <button
              type="button"
              onClick={
                submit
              }
            >
              Send emergency report
            </button>

          </div>

        </section>

        <aside className="live-summary">

          <div className="summary-title">

            <b>
              LIVE REPORT SUMMARY
            </b>

            <span>
              Updates while you report
            </span>

          </div>

          <div
            className={
              `priority ${statusTone(
                severity.level,
              )}`
            }
          >

            <small>
              Current priority
            </small>

            <b>
              {severity.level}
            </b>

            <strong>
              {severity.score}

              <i>
                /100
              </i>

            </strong>

          </div>

          <div className="bar">

            <i
              style={{
                width:
                  `${severity.score}%`,
              }}
            />

          </div>

          <Fact
            label="Emergency"
            value={
              emergencyLabels[
                form.type
              ]
            }
          />

          <Fact
            label="People"
            value={
              form.people
            }
          />

          <Fact
            label="Vulnerable"
            value={
              form.vulnerableGroups.length
                ? form.vulnerableGroups.join(
                    ", ",
                  )
                : "None selected"
            }
          />

          <Fact
            label="Location"
            value={
              form.gpsVerified
                ? "GPS verified"
                : form.address
                  ? "Address entered"
                  : "Needed"
            }
          />

          <Fact
            label="Evidence"
            value={
              form.mediaPreview
                ? "Photo attached"
                : "No photo"
            }
          />

          <Fact
            label="Confidence"
            value={
              `${confidence.score}/100 · ${confidence.label}`
            }
          />

          <details className="factor-box">

            <summary>
              Why this priority?
            </summary>

            {severity.factors.map(
              (
                factor,
              ) => (

                <div
                  key={
                    factor.label
                  }
                >

                  <span>
                    {factor.label}
                  </span>

                  <b>
                    +
                    {
                      Math.round(
                        factor.value,
                      )
                    }
                  </b>

                </div>

              ),
            )}

          </details>

          <div className="next-note">

            <b>
              What happens next
            </b>

            <p>
              AEGIS fuses this report into an incident,
              calculates priority and sends it to the
              Command Center for resource recommendation.
            </p>

          </div>

        </aside>

      </div>

    </main>
  );
}

/* =========================================================
   FORM SECTION
   ========================================================= */

function FormSection({
  n,
  title,
  hint,
  children,
}: {
  n: string;
  title: string;
  hint: string;
  children: ReactNode;
}) {
  return (
    <section className="form-section">

      <header>

        <span>
          {n}
        </span>

        <div>

          <h2>
            {title}
          </h2>

          <p>
            {hint}
          </p>

        </div>

      </header>

      {children}

    </section>
  );
}

/* =========================================================
   TRACK PAGE
   ========================================================= */

function TrackPage({
  reportId,
  reports,
}: {
  reportId?: string;
  reports: ReportRecord[];
}) {
  const report =
    reports.find(
      (item) =>
        item.id ===
        reportId,
    );

  const [
    shared,
    setShared,
  ] =
    useState(false);

  if (
    !report
  ) {
    return (
      <main className="narrow">

        <section className="empty">

          <span className="eyebrow">
            PUBLIC TRACKING
          </span>

          <h1>
            Report not found
          </h1>

          <p>
            The report may exist in another browser session
            or localStorage may have been cleared.
          </p>

          <a href="/report">
            Create a new report
          </a>

        </section>

      </main>
    );
  }

  const current =
    REPORT_STAGES.indexOf(
      report.status,
    );

  return (
    <main className="narrow">

      <section className="track-card">

        <span className="eyebrow">
          PUBLIC TRACKING / {report.id}
        </span>

        <h1>
          {report.label}
        </h1>

        <p>
          {report.address}
        </p>

        <div className="timeline">

          {REPORT_STAGES.map(
            (
              stage,
              index,
            ) => (

              <div
                className={
                  index <=
                  current
                    ? "done"
                    : ""
                }
                key={
                  stage
                }
              >

                <i>
                  {
                    index <
                    current
                      ? "✓"
                      : index +
                        1
                  }
                </i>

                <span>

                  <b>
                    {stage}
                  </b>

                  <small>
                    {
                      index ===
                      current
                        ? "Current status"

                        : index <
                            current
                          ? "Completed"

                          : "Pending"
                    }
                  </small>

                </span>

              </div>

            ),
          )}

        </div>

        <div className="track-facts">

          <Fact
            label="Severity"
            value={
              `${report.severityLevel} · ${report.severityScore}/100`
            }
          />

          <Fact
            label="People"
            value={
              report.people
            }
          />

          <Fact
            label="Reported"
            value={
              new Date(
                report.createdAt,
              ).toLocaleString()
            }
          />

          <Fact
            label="Incident"
            value={
              report.incidentId
            }
          />

        </div>

        <button
          className="primary-btn"
          onClick={() =>
            setShared(
              true,
            )
          }
        >
          {
            shared
              ? "Live-location demo enabled for 30 min"
              : "Share live location"
          }
        </button>

      </section>

    </main>
  );
}

/* =========================================================
   COMMAND CENTER
   ========================================================= */

function CommandPage({
  reports,
  incidents,
  resources,
  assignments,
  shelters,
  persist,
}: {
  reports: ReportRecord[];
  incidents: IncidentRecord[];
  resources: ResourceRecord[];
  assignments: AssignmentRecord[];
  shelters: ShelterRecord[];

  persist: (
    p: PersistPatch,
  ) => void;
}) {
  const [
    selectedId,
    setSelectedId,
  ] =
    useState(
      incidents[0]?.id ??
        "",
    );

  const [
    dispatching,
    setDispatching,
  ] =
    useState(false);

  useEffect(
    () => {
      if (
        !selectedId &&
        incidents[0]
      ) {
        setSelectedId(
          incidents[0].id,
        );
      }
    },
    [
      incidents,
      selectedId,
    ],
  );

  const sorted =
    useMemo(
      () =>
        [
          ...incidents,
        ]
          .filter(
            (incident) =>
              incident.status !==
              "RESOLVED",
          )
          .sort(
            (
              a,
              b,
            ) =>
              b.severityScore -
                a.severityScore ||
              new Date(
                a.createdAt,
              ).getTime() -
                new Date(
                  b.createdAt,
                ).getTime(),
          ),
      [
        incidents,
      ],
    );

  const selected =
    incidents.find(
      (incident) =>
        incident.id ===
        selectedId,
    ) ??
    sorted[0];

  const allocation =
    selected
      ? allocateResources(
          selected,
          resources,
        )
      : null;

  const hospitalRanks =
    selected
      ? rankHospitals(
          selected,
          hospitals,
        )
      : [];

  const cascade =
    selected
      ? cascadingRisks(
          selected,
          incidents,
        )
      : null;

  /* =======================================================
     LOAD GUIDED DEMO
     ======================================================= */

  function loadDemo() {
    const incident: IncidentRecord = {
      ...demoIncident,

      status:
        "ACKNOWLEDGED",

      assignedResourceIds:
        [],
    };

    const next =
      incidents.some(
        (item) =>
          item.id ===
          incident.id,
      )
        ? incidents.map(
            (item) =>
              item.id ===
              incident.id
                ? incident
                : item,
          )

        : [
            incident,
            ...incidents,
          ];

    /*
     * Loading demo itself creates NO moving assignments.
     */

    persist({
      incidents:
        next,

      resources:
        initialResources,

      assignments:
        [],
    });

    setSelectedId(
      incident.id,
    );
  }

  /* =======================================================
     DISPATCH

     THIS is the movement trigger.

     Only resources chosen for this incident get a fresh
     EN_ROUTE assignment. Because its timestamp is after
     sessionStartedAtRef, the movement engine activates it.
     ======================================================= */

  function dispatch() {
    if (
      !selected ||
      !allocation
    ) {
      return;
    }

    setDispatching(
      true,
    );

    const chosen =
      allocation.selected.filter(
        (choice) =>
          !selected.assignedResourceIds.includes(
            choice.resource.id,
          ),
      );

    const time =
      nowIso();

    const newAssignments: AssignmentRecord[] =
      chosen.map(
        (
          choice,
        ) => ({
          id:
            `ASG-${Date.now()}-${choice.resource.id}`,

          incidentId:
            selected.id,

          resourceId:
            choice.resource.id,

          status:
            "EN_ROUTE",

          etaMin:
            Math.round(
              choice.etaMin,
            ),

          createdAt:
            time,

          updatedAt:
            time,
        }),
      );

    const ids =
      Array.from(
        new Set([
          ...selected.assignedResourceIds,

          ...chosen.map(
            (
              choice,
            ) =>
              choice.resource.id,
          ),
        ]),
      );

    const nextIncidents =
      incidents.map(
        (
          incident,
        ) =>
          incident.id ===
          selected.id
            ? {
                ...incident,

                status:
                  "DISPATCHED" as const,

                assignedResourceIds:
                  ids,
              }

            : incident,
      );

    const nextReports =
      reports.map(
        (
          report,
        ) =>
          report.incidentId ===
          selected.id
            ? {
                ...report,

                status:
                  "Dispatched" as const,
              }

            : report,
      );

    const nextResources =
      resources.map(
        (
          resource,
        ) =>
          ids.includes(
            resource.id,
          )
            ? {
                ...resource,

                status:
                  "EN_ROUTE" as const,
              }

            : resource,
      );

    persist({
      incidents:
        nextIncidents,

      reports:
        nextReports,

      resources:
        nextResources,

      assignments: [
        ...newAssignments,
        ...assignments,
      ],
    });

    window.setTimeout(
      () =>
        setDispatching(
          false,
        ),
      400,
    );
  }

  const critical =
    sorted.filter(
      (incident) =>
        incident.severityLevel ===
        "CRITICAL",
    ).length;

  const available =
    resources.filter(
      (resource) =>
        resource.status ===
        "AVAILABLE",
    ).length;

  const redZones =
    zones.filter(
      (zone) =>
        scoreZone(
          zone,
        ).classification ===
        "RED ZONE",
    ).length;

  const peopleRisk =
    zones
      .filter(
        (zone) =>
          scoreZone(
            zone,
          ).score >=
          50,
      )
      .reduce(
        (
          sum,
          zone,
        ) =>
          sum +
          zone.population,
        0,
      );

  const freeShelter =
    shelters.reduce(
      (
        sum,
        shelter,
      ) =>
        sum +
        Math.max(
          0,

          shelter.maximumCapacity -
            shelter.currentOccupancy -
            shelter.reservedCapacity,
        ),
      0,
    );

  return (
    <main className="command-page">

      <section className="command-head">

        <div>

          <span className="eyebrow">
            OPS//03 · AUTHORITY MODE
          </span>

          <h1>
            Command Center
          </h1>

          <p>
            Prioritize. Allocate. Verify. Act.
          </p>

        </div>

        <div className="head-actions">

          <button
            onClick={
              loadDemo
            }
          >
            Load guided demo
          </button>

          <a href="/report">
            Citizen report ↗
          </a>

        </div>

      </section>

      <section className="metrics">

        <Metric
          label="Active incidents"
          value={
            sorted.length
          }
        />

        <Metric
          label="Critical"
          value={
            critical
          }
          tone="danger"
        />

        <Metric
          label="Available units"
          value={
            `${available}/${resources.length}`
          }
        />

        <Metric
          label="Red zones"
          value={
            redZones
          }
          tone="danger"
        />

        <Metric
          label="People at risk"
          value={
            peopleRisk.toLocaleString()
          }
        />

        <Metric
          label="Shelter capacity"
          value={
            freeShelter
          }
        />

      </section>

      <section className="ops-grid">

        <aside className="incident-rail">

          <header>

            <b>
              INCIDENT QUEUE
            </b>

            <span>
              {sorted.length}
              {" "}
              active
            </span>

          </header>

          {sorted.length ===
          0 ? (

            <div className="rail-empty">

              <b>
                No active incidents
              </b>

              <span>
                Submit a report or load the guided demo.
              </span>

            </div>

          ) : (

            sorted.map(
              (
                incident,
              ) => (

                <button
                  key={
                    incident.id
                  }
                  onClick={() =>
                    setSelectedId(
                      incident.id,
                    )
                  }
                  className={
                    selected?.id ===
                    incident.id
                      ? "active"
                      : ""
                  }
                >

                  <div>

                    <i
                      className={
                        `dot ${statusTone(
                          incident.severityLevel,
                        )}`
                      }
                    />

                    <b>
                      {incident.id}
                    </b>

                    <small>
                      {
                        ageLabel(
                          incident.createdAt,
                        )
                      }
                    </small>

                  </div>

                  <strong>
                    {
                      incident.title
                    }
                  </strong>

                  <p>
                    {
                      incident.location
                    }
                  </p>

                  <footer>

                    <span
                      className={
                        statusTone(
                          incident.severityLevel,
                        )
                      }
                    >
                      {
                        incident.severityLevel
                      }
                      {" "}
                      {
                        incident.severityScore
                      }
                    </span>

                    <span>
                      {
                        incident.people
                      }
                      {" "}
                      people
                    </span>

                  </footer>

                </button>

              ),
            )

          )}

        </aside>

        <section className="map-panel">

          <div className="panel-cap">

            <span>
              OPERATIONAL MAP
            </span>

            <small>
              OpenStreetMap / persistent layers
            </small>

          </div>

          <OperationalMap
            incidents={
              incidents
            }
            resources={
              resources
            }
            zones={
              zones
            }
            selectedIncident={
              selected
            }
          />

          <div className="map-legend">

            <span>
              <i className="incident" />
              Incident
            </span>

            <span>
              <i className="resource" />
              Unit
            </span>

            <span>
              <i className="risk" />
              Hazard
            </span>

          </div>

        </section>

        <aside className="intel-rail">

          {!selected ? (

            <div className="rail-empty">

              <b>
                No incident selected
              </b>

              <span>
                Choose an incident from the queue.
              </span>

            </div>

          ) : (

            <>

              <div className="incident-title">

                <span
                  className={
                    `severity-box ${statusTone(
                      selected.severityLevel,
                    )}`
                  }
                >
                  {
                    selected.severityLevel
                  }
                </span>

                <div>

                  <small>
                    {selected.id}
                    {" / "}
                    {
                      selected.status
                    }
                  </small>

                  <h2>
                    {
                      selected.title
                    }
                  </h2>

                  <p>
                    {
                      selected.location
                    }
                  </p>

                </div>

              </div>

              <div className="intel-facts">

                <Fact
                  label="Severity"
                  value={
                    `${selected.severityScore}/100`
                  }
                />

                <Fact
                  label="Confidence"
                  value={
                    `${selected.confidenceScore}/100 · ${selected.confidenceLabel}`
                  }
                />

                <Fact
                  label="People"
                  value={
                    selected.people
                  }
                />

                <Fact
                  label="Reports fused"
                  value={
                    selected.reportIds.length
                  }
                />

              </div>

              <h3 className="subhead">
                RECOMMENDED RESPONSE
              </h3>

              <div className="response-list">

                {allocation?.selected.map(
                  (
                    choice,
                  ) => (

                    <div
                      key={
                        choice.resource.id
                      }
                    >

                      <span className="unit-code">
                        {
                          choice.resource.id
                        }
                      </span>

                      <div>

                        <b>
                          {
                            choice.resource.label
                          }
                        </b>

                        <small>
                          {
                            choice.crossZone
                              ? "Cross-zone"
                              : "Local zone"
                          }
                          {" · "}
                          {
                            choice.distanceKm.toFixed(
                              1,
                            )
                          }
                          {" km"}
                        </small>

                      </div>

                      <strong>
                        {
                          Math.round(
                            choice.etaMin,
                          )
                        }
                        m
                      </strong>

                    </div>

                  ),
                )}

              </div>

              {allocation?.missing.length
                ? (

                  <div className="alert danger">
                    Missing:
                    {" "}
                    {
                      allocation.missing
                        .map(
                          formatType,
                        )
                        .join(
                          ", ",
                        )
                    }
                  </div>

                )
                : null}

              <button
                className="dispatch"
                disabled={
                  dispatching ||
                  selected.status ===
                    "DISPATCHED" ||
                  selected.status ===
                    "ON_SCENE"
                }
                onClick={
                  dispatch
                }
              >
                {
                  selected.status ===
                    "DISPATCHED" ||
                  selected.status ===
                    "ON_SCENE"
                    ? "Resources dispatched"

                    : dispatching
                      ? "Dispatching…"

                      : "Approve dispatch"
                }
              </button>

              <h3 className="subhead">
                HOSPITAL PRIORITY
              </h3>

              {hospitalRanks
                .slice(
                  0,
                  2,
                )
                .map(
                  (
                    hospital,
                    index,
                  ) => (

                    <div
                      className="hospital"
                      key={
                        hospital.hospital.id
                      }
                    >

                      <span>
                        {
                          index ===
                          0
                            ? "PRIMARY"
                            : "BACKUP"
                        }
                      </span>

                      <b>
                        {
                          hospital.hospital.name
                        }
                      </b>

                      <small>
                        {
                          hospital.distanceKm.toFixed(
                            1,
                          )
                        }
                        {" km · "}
                        {
                          hospital.hospital.capacity.available
                        }
                        {" beds · "}
                        {
                          hospital.hospital.capacity.icuFree
                        }
                        {" ICU"}
                      </small>

                    </div>

                  ),
                )}

              {cascade?.risks.length
                ? (

                  <>

                    <h3 className="subhead">
                      CASCADING RISK
                    </h3>

                    {cascade.risks.map(
                      (
                        risk,
                      ) => (

                        <div
                          className={
                            `alert ${statusTone(
                              risk.level,
                            )}`
                          }
                          key={
                            risk.title
                          }
                        >

                          <b>
                            {
                              risk.title
                            }
                          </b>

                          <span>
                            {
                              risk.advice
                            }
                          </span>

                        </div>

                      ),
                    )}

                  </>

                )
                : null}

            </>

          )}

        </aside>

      </section>

      <section className="zone-strip">

        <header>

          <b>
            ZONE STATUS
          </b>

          <a href="/relocation">
            Open relocation cell →
          </a>

        </header>

        <div>

          {zones.map(
            (
              zone,
            ) => {
              const risk =
                scoreZone(
                  zone,
                );

              const stress =
                calculateZoneStress(
                  zone.name.match(
                    /Zone \d+/,
                  )?.[0] ??
                    zone.name,

                  resources,
                  incidents,
                  assignments,
                );

              return (
                <article
                  key={
                    zone.id
                  }
                >

                  <small>
                    {zone.name}
                  </small>

                  <b>
                    {
                      risk.score
                    }
                    /100 ·
                    {" "}
                    {
                      risk.classification
                    }
                  </b>

                  <span>
                    Road:
                    {" "}
                    {
                      zone.roadAccess
                    }
                    {" · "}
                    Trend:
                    {" "}
                    {
                      zone.trend
                    }
                  </span>

                  <div className="mini-bar">

                    <i
                      style={{
                        width:
                          `${risk.score}%`,
                      }}
                    />

                  </div>

                  <footer>
                    Stress
                    {" "}
                    {
                      stress.score
                    }
                    % · vulnerable
                    {" "}
                    {
                      vulnerableAtRisk(
                        zone,
                      )
                    }
                  </footer>

                </article>
              );
            },
          )}

        </div>

      </section>

    </main>
  );
}

/* =========================================================
   OPERATIONAL MAP

   MAP INSTANCE IS CREATED ONCE.

   DATA CHANGES UPDATE MARKERS/LAYERS IN PLACE.

   THIS STOPS THE OLD CONSTANT MAP REBUILD / STUTTER.
   ========================================================= */

function OperationalMap({
  incidents,
  resources,
  zones: mapZones,
  selectedIncident,
}: {
  incidents: IncidentRecord[];
  resources: ResourceRecord[];
  zones: ZoneRecord[];
  selectedIncident?: IncidentRecord;
}) {
  const reactId =
    useId();

  const mapId =
    `aegis-map-${reactId.replace(
      /:/g,
      "",
    )}`;

  const [
    status,
    setStatus,
  ] =
    useState(
      "Loading OpenStreetMap…",
    );

  const [
    ready,
    setReady,
  ] =
    useState(false);

  const mapRef =
    useRef<any>(
      null,
    );

  const incidentMarkers =
    useRef<
      Map<string, any>
    >(
      new Map(),
    );

  const resourceMarkers =
    useRef<
      Map<string, any>
    >(
      new Map(),
    );

  const resourceTargets =
    useRef<
      Map<
        string,
        [
          number,
          number,
        ]
      >
    >(
      new Map(),
    );

  const zoneLayers =
    useRef<
      Map<string, any>
    >(
      new Map(),
    );

  const routeLines =
    useRef<
      Map<string, any>
    >(
      new Map(),
    );

  const routeCache =
    useRef<
      Map<
        string,
        Array<
          [
            number,
            number,
          ]
        >
      >
    >(
      new Map(),
    );

  const routePending =
    useRef<
      Set<string>
    >(
      new Set(),
    );

  const fitSignature =
    useRef("");

  const animationRef =
    useRef<
      number | null
    >(null);

  /* =======================================================
     CREATE LEAFLET ONCE
     ======================================================= */

  useEffect(() => {
    let cancelled =
      false;

    async function boot() {
      const win =
        window as any;

      if (
        !win.L
      ) {
        if (
          !document.querySelector(
            "link[data-aegis-leaflet]",
          )
        ) {
          const link =
            document.createElement(
              "link",
            );

          link.rel =
            "stylesheet";

          link.href =
            "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";

          link.setAttribute(
            "data-aegis-leaflet",
            "1",
          );

          document.head.appendChild(
            link,
          );
        }

        await new Promise<void>(
          (
            resolve,
            reject,
          ) => {
            const existing =
              document.querySelector(
                "script[data-aegis-leaflet]",
              ) as HTMLScriptElement | null;

            if (
              existing
            ) {
              if (
                win.L
              ) {
                resolve();

                return;
              }

              existing.addEventListener(
                "load",

                () =>
                  resolve(),

                {
                  once:
                    true,
                },
              );

              existing.addEventListener(
                "error",

                () =>
                  reject(),

                {
                  once:
                    true,
                },
              );

              return;
            }

            const script =
              document.createElement(
                "script",
              );

            script.src =
              "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";

            script.async =
              true;

            script.setAttribute(
              "data-aegis-leaflet",
              "1",
            );

            script.onload =
              () =>
                resolve();

            script.onerror =
              () =>
                reject();

            document.body.appendChild(
              script,
            );
          },
        );
      }

      if (
        cancelled ||
        !win.L ||
        mapRef.current
      ) {
        return;
      }

      const L =
        win.L;

      const map =
        L.map(
          mapId,
          {
            zoomControl:
              true,

            preferCanvas:
              true,
          },
        ).setView(
          [
            13.025,
            80.24,
          ],

          13,
        );

      mapRef.current =
        map;

      L.tileLayer(
        "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",

        {
          attribution:
            "© OpenStreetMap",

          maxZoom:
            18,
        },
      ).addTo(
        map,
      );

      /*
       * Static road hazards.
       */

      for (
        const hazard
        of roadHazards
      ) {
        L.circle(
          [
            hazard.lat,
            hazard.lng,
          ],

          {
            radius:
              hazard.radiusMeters,

            color:
              "#fb7185",

            fillColor:
              "#ef4444",

            fillOpacity:
              0.16,

            weight:
              2,
          },
        )
          .bindPopup(
            hazard.name,
          )
          .addTo(
            map,
          );
      }

      setReady(
        true,
      );

      setStatus(
        "OpenStreetMap active · persistent map instance",
      );

      const host =
        document.getElementById(
          mapId,
        );

      const observer =
        typeof ResizeObserver !==
          "undefined" &&
        host
          ? new ResizeObserver(
              () =>
                window.setTimeout(
                  () =>
                    map.invalidateSize(
                      false,
                    ),

                  30,
                ),
            )
          : null;

      observer?.observe(
        host!,
      );

      (
        map as any
      ).__observer =
        observer;

      window.setTimeout(
        () =>
          map.invalidateSize(
            false,
          ),

        100,
      );
    }

    boot().catch(
      () =>
        setStatus(
          "Map unavailable · coordinate logic still active",
        ),
    );

    return () => {
      cancelled =
        true;

      if (
        animationRef.current !==
        null
      ) {
        cancelAnimationFrame(
          animationRef.current,
        );
      }

      mapRef.current?.__observer?.disconnect?.();

      mapRef.current?.remove?.();

      mapRef.current =
        null;

      incidentMarkers.current.clear();

      resourceMarkers.current.clear();

      resourceTargets.current.clear();

      zoneLayers.current.clear();

      routeLines.current.clear();

      routeCache.current.clear();

      routePending.current.clear();
    };
  }, [
    mapId,
  ]);

  /* =======================================================
     SMOOTH RESOURCE VISUAL INTERPOLATION
     ======================================================= */

  useEffect(() => {
    if (
      !ready ||
      !mapRef.current
    ) {
      return;
    }

    let stopped =
      false;

    const tick =
      () => {
        if (
          stopped
        ) {
          return;
        }

        for (
          const [
            id,
            marker,
          ]
          of resourceMarkers.current
        ) {
          const target =
            resourceTargets.current.get(
              id,
            );

          if (
            !target
          ) {
            continue;
          }

          const current =
            marker.getLatLng();

          const dLat =
            target[0] -
            current.lat;

          const dLng =
            target[1] -
            current.lng;

          if (
            Math.abs(
              dLat,
            ) +
              Math.abs(
                dLng,
              ) <
            0.000002
          ) {
            marker.setLatLng(
              target,
            );
          } else {
            marker.setLatLng([
              current.lat +
                dLat *
                  0.18,

              current.lng +
                dLng *
                  0.18,
            ]);
          }
        }

        animationRef.current =
          requestAnimationFrame(
            tick,
          );
      };

    animationRef.current =
      requestAnimationFrame(
        tick,
      );

    return () => {
      stopped =
        true;

      if (
        animationRef.current !==
        null
      ) {
        cancelAnimationFrame(
          animationRef.current,
        );
      }
    };
  }, [
    ready,
  ]);

  /* =======================================================
     INCIDENT MARKERS
     ======================================================= */

  useEffect(() => {
    if (
      !ready ||
      !mapRef.current
    ) {
      return;
    }

    const L =
      (window as any).L;

    const map =
      mapRef.current;

    const ids =
      new Set(
        incidents.map(
          (
            incident,
          ) =>
            incident.id,
        ),
      );

    for (
      const [
        id,
        marker,
      ]
      of incidentMarkers.current
    ) {
      if (
        !ids.has(
          id,
        )
      ) {
        map.removeLayer(
          marker,
        );

        incidentMarkers.current.delete(
          id,
        );
      }
    }

    for (
      const incident
      of incidents
    ) {
      const color =
        incident.severityLevel ===
        "CRITICAL"
          ? "#ef4444"

          : incident.severityLevel ===
              "HIGH"
            ? "#f97316"

            : "#facc15";

      let marker =
        incidentMarkers.current.get(
          incident.id,
        );

      if (
        !marker
      ) {
        marker =
          L.circleMarker(
            [
              incident.lat,
              incident.lng,
            ],

            {
              radius:
                8,

              color,

              fillColor:
                color,

              fillOpacity:
                0.8,

              weight:
                2,
            },
          ).addTo(
            map,
          );

        incidentMarkers.current.set(
          incident.id,
          marker,
        );
      }

      marker.setLatLng([
        incident.lat,
        incident.lng,
      ]);

      marker.setRadius(
        selectedIncident?.id ===
          incident.id
          ? 12
          : 8,
      );

      marker.setStyle({
        color,

        fillColor:
          color,
      });

      marker.bindPopup(
        `${incident.id}: ${incident.title}<br/>${incident.severityLevel} ${incident.severityScore}/100`,
      );
    }
  }, [
    ready,
    incidents,
    selectedIncident?.id,
  ]);

  /* =======================================================
     RESOURCE MARKERS
     ======================================================= */

  useEffect(() => {
    if (
      !ready ||
      !mapRef.current
    ) {
      return;
    }

    const L =
      (window as any).L;

    const map =
      mapRef.current;

    const ids =
      new Set(
        resources.map(
          (
            resource,
          ) =>
            resource.id,
        ),
      );

    for (
      const [
        id,
        marker,
      ]
      of resourceMarkers.current
    ) {
      if (
        !ids.has(
          id,
        )
      ) {
        map.removeLayer(
          marker,
        );

        resourceMarkers.current.delete(
          id,
        );

        resourceTargets.current.delete(
          id,
        );
      }
    }

    for (
      const resource
      of resources
    ) {
      const color =
        resource.status ===
        "AVAILABLE"
          ? "#22c55e"

          : resource.status ===
              "EN_ROUTE"
            ? "#38bdf8"

            : resource.status ===
                "ON_SCENE"
              ? "#facc15"

              : "#64748b";

      let marker =
        resourceMarkers.current.get(
          resource.id,
        );

      if (
        !marker
      ) {
        marker =
          L.circleMarker(
            [
              resource.lat,
              resource.lng,
            ],

            {
              radius:
                7,

              color,

              fillColor:
                "#101519",

              fillOpacity:
                1,

              weight:
                3,
            },
          ).addTo(
            map,
          );

        resourceMarkers.current.set(
          resource.id,
          marker,
        );
      }

      /*
       * Change visual target.
       * Marker is not recreated.
       */

      resourceTargets.current.set(
        resource.id,

        [
          resource.lat,
          resource.lng,
        ],
      );

      marker.setStyle({
        color,

        weight:
          resource.status ===
          "EN_ROUTE"
            ? 4
            : 2,
      });

      marker.bindPopup(
        `<b>${resource.id}</b><br/>${resource.label}<br/>${resource.status}`,
      );
    }
  }, [
    ready,
    resources,
  ]);

  /* =======================================================
     ZONE RISK LAYERS
     ======================================================= */

  useEffect(() => {
    if (
      !ready ||
      !mapRef.current
    ) {
      return;
    }

    const L =
      (window as any).L;

    const map =
      mapRef.current;

    const ids =
      new Set(
        mapZones.map(
          (
            zone,
          ) =>
            zone.id,
        ),
      );

    for (
      const [
        id,
        layer,
      ]
      of zoneLayers.current
    ) {
      if (
        !ids.has(
          id,
        )
      ) {
        map.removeLayer(
          layer,
        );

        zoneLayers.current.delete(
          id,
        );
      }
    }

    for (
      const zone
      of mapZones
    ) {
      const risk =
        scoreZone(
          zone,
        );

      const color =
        risk.classification ===
        "RED ZONE"
          ? "#ef4444"

          : risk.classification ===
              "HIGH RISK"
            ? "#f97316"

            : "#eab308";

      const radius =
        risk.classification ===
        "RED ZONE"
          ? 850
          : 550;

      let layer =
        zoneLayers.current.get(
          zone.id,
        );

      if (
        !layer
      ) {
        layer =
          L.circle(
            [
              zone.lat,
              zone.lng,
            ],

            {
              radius,

              color,

              fillColor:
                color,

              fillOpacity:
                0.07,

              weight:
                1,
            },
          ).addTo(
            map,
          );

        zoneLayers.current.set(
          zone.id,
          layer,
        );
      }

      layer.setLatLng([
        zone.lat,
        zone.lng,
      ]);

      layer.setRadius(
        radius,
      );

      layer.setStyle({
        color,

        fillColor:
          color,
      });

      layer.bindPopup(
        `${zone.name}<br/>Risk ${risk.score}/100 ${risk.classification}`,
      );
    }
  }, [
    ready,
    mapZones,
  ]);

  /* =======================================================
     ROUTE LINES + OSRM

     Only EN_ROUTE resources assigned to the selected
     incident receive route lines.

     OSRM road routes are cached.
     ======================================================= */

  useEffect(() => {
    if (
      !ready ||
      !mapRef.current
    ) {
      return;
    }

    const L =
      (window as any).L;

    const map =
      mapRef.current;

    const target =
      selectedIncident ??
      incidents[0];

    const moving =
      target
        ? resources.filter(
            (
              resource,
            ) =>
              resource.status ===
                "EN_ROUTE" &&
              target.assignedResourceIds.includes(
                resource.id,
              ),
          )

        : [];

    const ids =
      new Set(
        moving.map(
          (
            resource,
          ) =>
            resource.id,
        ),
      );

    for (
      const [
        id,
        line,
      ]
      of routeLines.current
    ) {
      if (
        !ids.has(
          id,
        )
      ) {
        map.removeLayer(
          line,
        );

        routeLines.current.delete(
          id,
        );
      }
    }

    if (
      !target
    ) {
      setStatus(
        "OpenStreetMap active · waiting for incident",
      );

      return;
    }

    for (
      const resource
      of moving
    ) {
      const key =
        `${resource.id}:${target.id}`;

      const direct: Array<
        [
          number,
          number,
        ]
      > = [
        [
          resource.lat,
          resource.lng,
        ],

        [
          target.lat,
          target.lng,
        ],
      ];

      const cached =
        routeCache.current.get(
          key,
        );

      const coordinates =
        cached ??
        direct;

      let line =
        routeLines.current.get(
          resource.id,
        );

      if (
        !line
      ) {
        line =
          L.polyline(
            coordinates,

            {
              color:
                resource.type ===
                "boat"
                  ? "#a855f7"
                  : "#38bdf8",

              weight:
                3,

              dashArray:
                "8 8",

              opacity:
                0.75,
            },
          ).addTo(
            map,
          );

        routeLines.current.set(
          resource.id,
          line,
        );
      } else {
        line.setLatLngs(
          coordinates,
        );
      }

      /*
       * OSRM route geometry.
       *
       * Boat/drone keep a direct visual route because
       * road routing does not apply to them.
       */

      if (
        !cached &&
        !routePending.current.has(
          key,
        ) &&
        resource.type !==
          "boat" &&
        resource.type !==
          "drone"
      ) {
        routePending.current.add(
          key,
        );

        fetch(
          `https://router.project-osrm.org/route/v1/driving/${resource.lng},${resource.lat};${target.lng},${target.lat}?overview=full&geometries=geojson`,
        )
          .then(
            (
              response,
            ) =>
              response.ok
                ? response.json()
                : Promise.reject(),
          )
          .then(
            (
              data: any,
            ) => {
              const route =
                data?.routes?.[
                  0
                ];

              if (
                !route?.geometry?.coordinates
              ) {
                return;
              }

              const path =
                route.geometry.coordinates.map(
                  (
                    point: [
                      number,
                      number,
                    ],
                  ) =>
                    [
                      point[1],
                      point[0],
                    ] as [
                      number,
                      number,
                    ],
                );

              routeCache.current.set(
                key,
                path,
              );

              routeLines.current
                .get(
                  resource.id,
                )
                ?.setLatLngs(
                  path,
                );
            },
          )
          .catch(
            () =>
              undefined,
          )
          .finally(
            () =>
              routePending.current.delete(
                key,
              ),
          );
      }
    }

    setStatus(
      moving.length
        ? `OpenStreetMap active · ${moving.length} unit${
            moving.length ===
            1
              ? ""
              : "s"
          } moving`

        : "OpenStreetMap active · command layers ready",
    );
  }, [
    ready,
    resources,
    incidents,
    selectedIncident,
  ]);

  /* =======================================================
     CAMERA

     Resource movement itself does NOT constantly recenter
     the map.
     ======================================================= */

  useEffect(() => {
    if (
      !ready ||
      !mapRef.current
    ) {
      return;
    }

    const signature =
      `${
        incidents
          .map(
            (
              incident,
            ) =>
              incident.id,
          )
          .join(
            ",",
          )
      }|${
        mapZones
          .map(
            (
              zone,
            ) =>
              zone.id,
          )
          .join(
            ",",
          )
      }|${
        selectedIncident?.id ??
        ""
      }`;

    if (
      fitSignature.current ===
      signature
    ) {
      return;
    }

    if (
      selectedIncident
    ) {
      mapRef.current.setView(
        [
          selectedIncident.lat,
          selectedIncident.lng,
        ],

        14,

        {
          animate:
            true,
        },
      );
    } else {
      const points = [
        ...incidents.map(
          (
            incident,
          ) =>
            [
              incident.lat,
              incident.lng,
            ] as [
              number,
              number,
            ],
        ),

        ...mapZones.map(
          (
            zone,
          ) =>
            [
              zone.lat,
              zone.lng,
            ] as [
              number,
              number,
            ],
        ),
      ];

      if (
        points.length >
        1
      ) {
        mapRef.current.fitBounds(
          points,

          {
            padding: [
              28,
              28,
            ],

            animate:
              false,
          },
        );
      } else {
        mapRef.current.setView(
          points[0] ?? [
            13.025,
            80.24,
          ],

          13,
        );
      }
    }

    fitSignature.current =
      signature;
  }, [
    ready,
    incidents,
    mapZones,
    selectedIncident?.id,
  ]);

  return (
    <div className="op-map">

      <div
        id={mapId}
        className="leaflet-host"
      />

      <div className="map-status">

        <span className="truth real">
          OSM MAP
        </span>

        <span>
          {status}
        </span>

      </div>

    </div>
  );
}

/* =========================================================
   RESPONDER PAGE
   ========================================================= */

function ResponderPage({
  reports,
  incidents,
  resources,
  assignments,
  persist,
}: {
  reports: ReportRecord[];
  incidents: IncidentRecord[];
  resources: ResourceRecord[];
  assignments: AssignmentRecord[];

  persist: (
    p: PersistPatch,
  ) => void;
}) {
  const [
    unitId,
    setUnitId,
  ] =
    useState(
      resources.find(
        (
          resource,
        ) =>
          resource.type ===
          "ambulance",
      )?.id ??
        resources[0]?.id ??
        "A1",
    );

  const [
    gpsMessage,
    setGpsMessage,
  ] =
    useState(
      "GPS idle",
    );

  const unit =
    resources.find(
      (
        resource,
      ) =>
        resource.id ===
        unitId,
    );

  const assignment =
    assignments.find(
      (
        item,
      ) =>
        item.resourceId ===
          unitId &&
        item.status !==
          "RESOLVED",
    );

  const incident =
    assignment
      ? incidents.find(
          (
            item,
          ) =>
            item.id ===
            assignment.incidentId,
        )
      : undefined;

  const report =
    incident
      ? reports.find(
          (
            item,
          ) =>
            item.incidentId ===
            incident.id,
        )
      : undefined;

  function updateStatus(
    status: AssignmentRecord["status"],
  ) {
    if (
      !assignment ||
      !unit
    ) {
      return;
    }

    const time =
      nowIso();

    const nextAssignments =
      assignments.map(
        (
          item,
        ) =>
          item.id ===
          assignment.id
            ? {
                ...item,

                status,

                updatedAt:
                  time,
              }

            : item,
      );

    const nextResources =
      resources.map(
        (
          resource,
        ) =>
          resource.id ===
          unit.id
            ? {
                ...resource,

                status:
                  status ===
                  "ON_SCENE"
                    ? "ON_SCENE" as const

                    : status ===
                        "RESOLVED"
                      ? "AVAILABLE" as const

                      : "EN_ROUTE" as const,
              }

            : resource,
      );

    const nextIncidents =
      incidents.map(
        (
          item,
        ) =>
          item.id ===
          incident?.id
            ? {
                ...item,

                status:
                  status ===
                  "ON_SCENE"
                    ? "ON_SCENE" as const

                    : status ===
                        "RESOLVED"
                      ? "RESOLVED" as const

                      : "DISPATCHED" as const,
              }

            : item,
      );

    const reportStatus: ReportStage =
      status ===
      "ON_SCENE"
        ? "On Scene"

        : status ===
            "RESOLVED"
          ? "Resolved"

          : "Dispatched";

    const nextReports =
      reports.map(
        (
          item,
        ) =>
          item.incidentId ===
          incident?.id
            ? {
                ...item,

                status:
                  reportStatus,
              }

            : item,
      );

    persist({
      assignments:
        nextAssignments,

      resources:
        nextResources,

      incidents:
        nextIncidents,

      reports:
        nextReports,
    });
  }

  function gps() {
    if (
      !navigator.geolocation
    ) {
      setGpsMessage(
        "GPS unavailable",
      );

      return;
    }

    setGpsMessage(
      "Locating…",
    );

    navigator.geolocation
      .getCurrentPosition(

        (
          position,
        ) => {
          const next =
            resources.map(
              (
                resource,
              ) =>
                resource.id ===
                unitId
                  ? {
                      ...resource,

                      lat:
                        position.coords.latitude,

                      lng:
                        position.coords.longitude,
                    }

                  : resource,
            );

          persist({
            resources:
              next,
          });

          setGpsMessage(
            `${
              position.coords.latitude.toFixed(
                5,
              )
            }, ${
              position.coords.longitude.toFixed(
                5,
              )
            }`,
          );
        },

        () =>
          setGpsMessage(
            "Permission denied",
          ),

        {
          enableHighAccuracy:
            true,
        },
      );
  }

  return (
    <main className="responder-page">

      <section className="responder-shell">

        <header>

          <div>

            <span className="eyebrow">
              FIELD CHANNEL
            </span>

            <h1>
              Responder
            </h1>

          </div>

          <select
            value={
              unitId
            }
            onChange={
              (
                event,
              ) =>
                setUnitId(
                  event.target.value,
                )
            }
          >

            {resources.map(
              (
                resource,
              ) => (

                <option
                  key={
                    resource.id
                  }
                  value={
                    resource.id
                  }
                >
                  {resource.id}
                  {" · "}
                  {
                    resource.label
                  }
                </option>

              ),
            )}

          </select>

        </header>

        <div className="unit-banner">

          <Fact
            label="Unit"
            value={
              unit?.id ??
              "—"
            }
          />

          <Fact
            label="Status"
            value={
              unit?.status ??
              "—"
            }
          />

          <Fact
            label="Crew"
            value={
              unit?.crew ??
              "—"
            }
          />

        </div>

        {!assignment ||
        !incident ? (

          <div className="field-empty">

            <b>
              No active assignment
            </b>

            <span>
              This unit is waiting for Command Center dispatch.
            </span>

          </div>

        ) : (

          <>

            <section className="field-incident">

              <div
                className={
                  `field-severity ${statusTone(
                    incident.severityLevel,
                  )}`
                }
              >

                <small>
                  {
                    incident.severityLevel
                  }
                </small>

                <b>
                  {
                    incident.severityScore
                  }
                </b>

              </div>

              <div>

                <small>
                  {incident.id}
                </small>

                <h2>
                  {
                    incident.title
                  }
                </h2>

                <p>
                  {
                    incident.location
                  }
                </p>

              </div>

            </section>

            <div className="field-facts">

              <Fact
                label="ETA"
                value={
                  `${assignment.etaMin} min`
                }
              />

              <Fact
                label="People"
                value={
                  incident.people
                }
              />

              <Fact
                label="Citizen note"
                value={
                  report?.description ||
                  "No additional note"
                }
              />

              <Fact
                label="GPS"
                value={
                  gpsMessage
                }
              />

            </div>

            <button
              className="gps-field"
              onClick={
                gps
              }
            >
              Update my live location
            </button>

            <div className="status-actions">

              <button
                onClick={() =>
                  updateStatus(
                    "ACCEPTED",
                  )
                }
              >
                Accept
              </button>

              <button
                onClick={() =>
                  updateStatus(
                    "EN_ROUTE",
                  )
                }
              >
                En route
              </button>

              <button
                onClick={() =>
                  updateStatus(
                    "ON_SCENE",
                  )
                }
              >
                On scene
              </button>

              <button
                className="resolve"
                onClick={() =>
                  updateStatus(
                    "RESOLVED",
                  )
                }
              >
                Resolved
              </button>

            </div>

          </>

        )}

      </section>

    </main>
  );
}

/* =========================================================
   WHAT-IF SIMULATOR
   ========================================================= */

function SimulatorPage({
  incidents,
  resources,
  assignments,
  shelters,
}: {
  incidents: IncidentRecord[];
  resources: ResourceRecord[];
  assignments: AssignmentRecord[];
  shelters: ShelterRecord[];
}) {
  const [
    type,
    setType,
  ] =
    useState<EmergencyType>(
      "flood",
    );

  const [
    lat,
    setLat,
  ] =
    useState(
      13.0124,
    );

  const [
    lng,
    setLng,
  ] =
    useState(
      80.2268,
    );

  const [
    severity,
    setSeverity,
  ] =
    useState(
      85,
    );

  const [
    toggles,
    setToggles,
  ] =
    useState<
      Record<
        string,
        boolean
      >
    >({
      ...SIM_TOGGLES,
    });

  function run(
    state:
      Record<
        string,
        boolean
      >,
  ) {
    return runSimulation({
      type,
      lat,
      lng,
      severity,

      toggles:
        state,

      resources,
      incidents,
      shelters,
      zones,
      hospitals,
      assignments,
    });
  }

  const baseline =
    useMemo(
      () =>
        run({}),
      [
        type,
        lat,
        lng,
        severity,
        resources,
        incidents,
        shelters,
        assignments,
      ],
    );

  const after =
    useMemo(
      () =>
        run(
          toggles,
        ),
      [
        type,
        lat,
        lng,
        severity,
        toggles,
        resources,
        incidents,
        shelters,
        assignments,
      ],
    );

  return (
    <main className="sim-page">

      <section className="page-title">

        <span className="eyebrow">
          DECISION LAB / RULE-BASED PROTOTYPE
        </span>

        <h1>
          What-If Simulator
        </h1>

        <p>
          Stress the response network before making a real
          operational decision.
        </p>

      </section>

      <section className="sim-controls">

        <label>

          <span>
            Incident type
          </span>

          <select
            value={
              type
            }
            onChange={
              (
                event,
              ) =>
                setType(
                  event.target.value as EmergencyType,
                )
            }
          >

            {Object.entries(
              emergencyLabels,
            ).map(
              ([
                key,
                value,
              ]) => (

                <option
                  key={
                    key
                  }
                  value={
                    key
                  }
                >
                  {value}
                </option>

              ),
            )}

          </select>

        </label>

        <label>

          <span>
            Severity
          </span>

          <input
            type="range"
            min="10"
            max="100"
            value={
              severity
            }
            onChange={
              (
                event,
              ) =>
                setSeverity(
                  Number(
                    event.target.value,
                  ),
                )
            }
          />

          <b>
            {severity}
          </b>

        </label>

        <label>

          <span>
            Latitude
          </span>

          <input
            type="number"
            step="0.0001"
            value={
              lat
            }
            onChange={
              (
                event,
              ) =>
                setLat(
                  Number(
                    event.target.value,
                  ),
                )
            }
          />

        </label>

        <label>

          <span>
            Longitude
          </span>

          <input
            type="number"
            step="0.0001"
            value={
              lng
            }
            onChange={
              (
                event,
              ) =>
                setLng(
                  Number(
                    event.target.value,
                  ),
                )
            }
          />

        </label>

      </section>

      <section className="toggle-bank">

        <header>

          <b>
            FAILURE CONDITIONS
          </b>

          <span>
            Turn conditions on/off
          </span>

        </header>

        <div>

          {Object.keys(
            SIM_TOGGLES,
          ).map(
            (
              key,
            ) => (

              <button
                type="button"
                key={
                  key
                }
                className={
                  toggles[
                    key
                  ]
                    ? "active"
                    : ""
                }
                onClick={() =>
                  setToggles(
                    (
                      current,
                    ) => ({
                      ...current,

                      [key]:
                        !current[
                          key
                        ],
                    }),
                  )
                }
              >
                {
                  key.replace(
                    /[A-Z]/g,

                    (
                      match,
                    ) =>
                      ` ${match.toLowerCase()}`,
                  )
                }
              </button>

            ),
          )}

        </div>

      </section>

      <section className="compare">

        <SimulationCard
          title="BASELINE"
          result={
            baseline
          }
        />

        <SimulationCard
          title="AFTER SCENARIO"
          result={
            after
          }
        />

      </section>

    </main>
  );
}

/* =========================================================
   SIMULATION RESULT
   ========================================================= */

function SimulationCard({
  title,
  result,
}: {
  title: string;
  result: ReturnType<
    typeof runSimulation
  >;
}) {
  return (
    <article className="sim-result">

      <header>

        <span>
          {title}
        </span>

        <b
          className={
            result.canHandle
              ? "ok"
              : "danger"
          }
        >
          {
            result.canHandle
              ? "CAN HANDLE"
              : "CAPACITY RISK"
          }
        </b>

      </header>

      <div className="sim-metrics">

        <Fact
          label="Avg ETA"
          value={
            `${Math.round(
              result.allocation.averageEta,
            )} min`
          }
        />

        <Fact
          label="Zone stress"
          value={
            `${result.stress.score}% · ${result.stress.level}`
          }
        />

        <Fact
          label="Missing"
          value={
            result.allocation.missing.length
              ? result.allocation.missing
                  .map(
                    formatType,
                  )
                  .join(
                    ", ",
                  )
              : "None"
          }
        />

        <Fact
          label="Route"
          value={
            result.routeBlocked
              ? "Detour required"
              : "Nominal"
          }
        />

      </div>

      <h3>
        RECOMMENDATIONS
      </h3>

      <div className="recommendations">

        {result.recommendations.map(
          (
            recommendation,
            index,
          ) => (

            <div
              key={
                `${recommendation.text}-${index}`
              }
              className={
                statusTone(
                  recommendation.level,
                )
              }
            >

              <b>
                {
                  recommendation.level
                }
              </b>

              <span>
                {
                  recommendation.text
                }
              </span>

            </div>

          ),
        )}

      </div>

      <h3>
        PRIORITY FACILITIES
      </h3>

      <div className="facility-pair">

        <div>

          <small>
            Hospital
          </small>

          <b>
            {
              result.hospitalPriority?.hospital.name ??
              "Unavailable"
            }
          </b>

        </div>

        <div>

          <small>
            Shelter
          </small>

          <b>
            {
              result.shelterPriority?.shelter.name ??
              "Unavailable"
            }
          </b>

        </div>

      </div>

    </article>
  );
}

/* =========================================================
   RELOCATION
   ========================================================= */

function RelocationPage({
  resources,
  shelters,
  persist,
}: {
  resources: ResourceRecord[];
  shelters: ShelterRecord[];

  persist: (
    p: PersistPatch,
  ) => void;
}) {
  const [
    zoneId,
    setZoneId,
  ] =
    useState(
      zones[0].id,
    );

  const zone =
    zones.find(
      (
        item,
      ) =>
        item.id ===
        zoneId,
    ) ??
    zones[0];

  const risk =
    scoreZone(
      zone,
    );

  const plan =
    buildRelocationPlan(
      zone,
      shelters,
      resources,
    );

  function makeFull(
    id: string,
  ) {
    persist({
      shelters:
        shelters.map(
          (
            shelter,
          ) =>
            shelter.id ===
            id
              ? {
                  ...shelter,

                  currentOccupancy:
                    shelter.maximumCapacity,

                  status:
                    "FULL" as const,
                }

              : shelter,
        ),
    });
  }

  return (
    <main className="relocation-page">

      <section className="page-title">

        <span className="eyebrow">
          RISK & RELOCATION CELL / SIH26191-INSPIRED EXTENSION
        </span>

        <h1>
          Move people before the hazard moves.
        </h1>

        <p>
          Red-zone intelligence, vulnerable population,
          shelter capacity and relocation.
        </p>

      </section>

      <section className="zone-tabs">

        {zones.map(
          (
            item,
          ) => {
            const itemRisk =
              scoreZone(
                item,
              );

            return (
              <button
                key={
                  item.id
                }
                className={
                  zoneId ===
                  item.id
                    ? "active"
                    : ""
                }
                onClick={() =>
                  setZoneId(
                    item.id,
                  )
                }
              >

                <small>
                  {item.id}
                </small>

                <b>
                  {
                    item.name.replace(
                      /^Zone \d+ – /,
                      "",
                    )
                  }
                </b>

                <span
                  className={
                    statusTone(
                      itemRisk.classification,
                    )
                  }
                >
                  {
                    itemRisk.score
                  }
                  {" · "}
                  {
                    itemRisk.classification
                  }
                </span>

              </button>
            );
          },
        )}

      </section>

      <section className="relocation-grid">

        <article className="risk-card">

          <header>

            <span>
              {zone.name}
            </span>

            <b
              className={
                statusTone(
                  risk.classification,
                )
              }
            >
              {
                risk.classification
              }
            </b>

          </header>

          <div className="risk-score">

            <strong>
              {risk.score}
            </strong>

            <small>
              /100 RISK
            </small>

          </div>

          <Fact
            label="Hazard severity"
            value={
              zone.hazardSeverity
            }
          />

          <Fact
            label="Population exposure"
            value={
              zone.exposure
            }
          />

          <Fact
            label="Vulnerability"
            value={
              zone.vulnerability
            }
          />

          <Fact
            label="Access risk"
            value={
              zone.accessRisk
            }
          />

          <div className="risk-line">

            <i
              style={{
                width:
                  `${risk.score}%`,
              }}
            />

          </div>

        </article>

        <article className="population-card">

          <span className="eyebrow">
            VULNERABLE POPULATION
          </span>

          <h2>
            {
              zone.population.toLocaleString()
            }
          </h2>

          <p>
            people in habitation
          </p>

          <Fact
            label="Elderly"
            value={
              zone.elderly
            }
          />

          <Fact
            label="Children"
            value={
              zone.children
            }
          />

          <Fact
            label="Disabled"
            value={
              zone.disabled
            }
          />

          <Fact
            label="Medical-dependent"
            value={
              zone.medicalDependent
            }
          />

          <strong>
            {
              vulnerableAtRisk(
                zone,
              )
            }
            {" "}
            high-priority people
          </strong>

        </article>

        <article className="plan-card">

          <span className="eyebrow">
            RELOCATION PRIORITY
          </span>

          <h2
            className={
              statusTone(
                plan.priority.classification,
              )
            }
          >
            {
              plan.priority.classification
            }
          </h2>

          <p>
            Priority score {plan.priority.score}/100
          </p>

          <Fact
            label="Buses"
            value={
              `${plan.suggested.buses} needed / ${plan.availableTransport.buses} available`
            }
          />

          <Fact
            label="Ambulances"
            value={
              `${plan.suggested.ambulances} / ${plan.availableTransport.ambulances}`
            }
          />

          <Fact
            label="Police"
            value={
              `${plan.suggested.police} / ${plan.availableTransport.police}`
            }
          />

          <Fact
            label="Boats"
            value={
              `${plan.suggested.boats} / ${plan.availableTransport.boats}`
            }
          />

        </article>

      </section>

      <section className="shelter-board">

        <header>

          <div>

            <span className="eyebrow">
              CAPACITY-AWARE DISTRIBUTION
            </span>

            <h2>
              Safe shelter allocation
            </h2>

          </div>

          <b
            className={
              plan.insufficient
                ? "danger"
                : "ok"
            }
          >
            {
              plan.insufficient
                ? `${plan.remainingPopulation} UNALLOCATED`
                : "POPULATION COVERED"
            }
          </b>

        </header>

        <div className="shelter-list">

          {plan.rankedShelters.map(
            (
              shelter,
              index,
            ) => (

              <article
                key={
                  shelter.shelter.id
                }
              >

                <div className="shelter-rank">
                  {
                    String(
                      index +
                        1,
                    ).padStart(
                      2,
                      "0",
                    )
                  }
                </div>

                <div>

                  <b>
                    {
                      shelter.shelter.name
                    }
                  </b>

                  <span>
                    {
                      shelter.distanceKm.toFixed(
                        1,
                      )
                    }
                    {" km · road safety "}
                    {
                      shelter.shelter.roadSafety
                    }
                    /100
                  </span>

                </div>

                <div>

                  <small>
                    REMAINING
                  </small>

                  <strong>
                    {
                      shelter.remaining
                    }
                  </strong>

                </div>

                <div>

                  <small>
                    SCORE
                  </small>

                  <strong>
                    {
                      shelter.score
                    }
                  </strong>

                </div>

                <button
                  onClick={() =>
                    makeFull(
                      shelter.shelter.id,
                    )
                  }
                >
                  Simulate full
                </button>

              </article>

            ),
          )}

        </div>

      </section>

      <section className="allocation-board">

        <header>

          <span className="eyebrow">
            RELOCATION PLAN
          </span>

          <h2>
            Population distribution
          </h2>

        </header>

        {plan.allocations.map(
          (
            allocation,
          ) => (

            <div
              key={
                allocation.shelter.id
              }
            >

              <span>

                <b>
                  {
                    allocation.people
                  }
                </b>

                {" "}
                people

              </span>

              <i>
                →
              </i>

              <strong>
                {
                  allocation.shelter.name
                }
              </strong>

              <small>
                {
                  allocation.distanceKm.toFixed(
                    1,
                  )
                }
                {" km · "}
                {
                  allocation.routeRisk
                }
              </small>

            </div>

          ),
        )}

        {plan.insufficient && (

          <div className="capacity-fail">

            <b>
              INSUFFICIENT SAFE SHELTER CAPACITY
            </b>

            <span>
              Temporary relief center or mutual aid is required.
            </span>

          </div>

        )}

      </section>

    </main>
  );
}

/* =========================================================
   SMALL COMPONENTS
   ========================================================= */

function Fact({
  label,
  value,
}: {
  label: string;
  value:
    | string
    | number;
}) {
  return (
    <div className="fact">

      <span>
        {label}
      </span>

      <b>
        {value}
      </b>

    </div>
  );
}

function Metric({
  label,
  value,
  tone = "",
}: {
  label: string;
  value:
    | string
    | number;
  tone?: string;
}) {
  return (
    <article
      className={
        `metric ${tone}`
      }
    >

      <span>
        {label}
      </span>

      <b>
        {value}
      </b>

    </article>
  );
}

/* =========================================================
   FULL UI CSS
   ========================================================= */

const APP_CSS =
  String.raw`

* {
  box-sizing: border-box;
}

.aegis-root {
  --bg: #0b0f13;
  --panel: #10161b;
  --line: #29323a;
  --muted: #85919a;
  --red: #df5750;
  --amber: #dca84e;
  --green: #62b87b;

  min-height: 100vh;

  background: var(--bg);

  color: #e8edf0;

  font-family:
    Inter,
    Segoe UI,
    Arial,
    sans-serif;
}

.aegis-root button,
.aegis-root input,
.aegis-root select,
.aegis-root textarea {
  font: inherit;
}

.aegis-root a {
  text-decoration: none;
  color: inherit;
}

.eyebrow {
  font:
    700
    0.62rem
    Consolas,
    monospace;

  letter-spacing: 0.08em;

  color: #91a0aa;

  text-transform: uppercase;
}

.danger {
  color: #ff817b !important;
}

.warn {
  color: #efbd6d !important;
}

.ok {
  color: #77ce91 !important;
}

.neutral {
  color: #c4cbd0 !important;
}

/* =========================================================
   NAV
   ========================================================= */

.ops-nav {
  height: 72px;

  display: flex;
  align-items: center;

  gap: 24px;

  padding:
    0
    28px;

  border-bottom:
    1px solid #283038;

  background:
    #0c1115;

  position: sticky;

  top: 0;

  z-index: 999;
}

.brand {
  display: flex;
  align-items: center;

  gap: 10px;

  min-width:
    275px;
}

.brand
> span:last-child {
  display: grid;
}

.brand b {
  font-size:
    1.1rem;

  letter-spacing:
    0.16em;
}

.brand small {
  font-size:
    0.6rem;

  color:
    #7f8a93;
}

.brand-mark {
  width:
    30px;

  height:
    30px;

  border:
    1px solid #6d7881;

  position:
    relative;
}

.brand-mark i {
  position:
    absolute;

  background:
    #d8544d;
}

.brand-mark
i:nth-child(1) {
  width:
    14px;

  height:
    2px;

  left:
    7px;

  top:
    13px;
}

.brand-mark
i:nth-child(2) {
  width:
    2px;

  height:
    14px;

  left:
    13px;

  top:
    7px;
}

.brand-mark
i:nth-child(3) {
  width:
    5px;

  height:
    5px;

  right:
    -3px;

  top:
    -3px;
}

.ops-nav nav {
  display:
    flex;

  align-self:
    stretch;

  overflow:
    auto;
}

.ops-nav nav a {
  display:
    grid;

  place-items:
    center;

  padding:
    0
    14px;

  color:
    #96a0a8;

  font-size:
    0.7rem;

  font-weight:
    700;

  text-transform:
    uppercase;

  white-space:
    nowrap;
}

.ops-nav nav a:hover,
.ops-nav nav a.active {
  background:
    #12181e;

  color:
    #fff;

  box-shadow:
    inset
    0
    -2px
    #d8544d;
}

.live {
  margin-left:
    auto;

  display:
    flex;

  gap:
    7px;

  align-items:
    center;

  color:
    #7f8a93;

  font:
    700
    0.6rem
    Consolas,
    monospace;
}

.live i {
  width:
    7px;

  height:
    7px;

  border-radius:
    50%;

  background:
    #62b87b;
}

/* =========================================================
   LANDING
   ========================================================= */

.landing {
  padding:
    54px
    34px;

  max-width:
    1500px;

  margin:
    auto;
}

.hero {
  min-height:
    430px;

  border:
    1px solid var(--line);

  padding:
    54px;

  display:
    flex;

  flex-direction:
    column;

  justify-content:
    flex-end;

  background:
    linear-gradient(
      115deg,
      #11171d 0 58%,
      #0d1216 58%
    );
}

.hero h1 {
  font:
    500
    clamp(
      3rem,
      7vw,
      7rem
    )/.92
    Georgia,
    serif;

  letter-spacing:
    -0.055em;

  margin:
    18px
    0
    20px;

  max-width:
    1100px;
}

.hero p {
  max-width:
    760px;

  color:
    #a5afb6;

  line-height:
    1.7;
}

.flow {
  display:
    flex;

  align-items:
    center;

  gap:
    10px;

  margin-top:
    32px;

  font:
    700
    0.6rem
    Consolas,
    monospace;

  color:
    #b7c0c6;

  flex-wrap:
    wrap;
}

.flow i {
  height:
    1px;

  width:
    38px;

  background:
    #3b454e;
}

.role-grid {
  display:
    grid;

  grid-template-columns:
    repeat(
      4,
      1fr
    );

  margin-top:
    16px;

  border-left:
    1px solid var(--line);
}

.role {
  min-height:
    180px;

  padding:
    22px;

  display:
    flex;

  flex-direction:
    column;

  border:
    1px solid var(--line);

  border-left:
    0;

  background:
    #10161b;
}

.role.light {
  background:
    #ece8df;

  color:
    #1c2125;
}

.role small {
  font:
    700
    0.6rem
    Consolas,
    monospace;

  color:
    #8d979e;
}

.role b {
  font:
    600
    1.3rem
    Georgia,
    serif;

  margin-top:
    auto;
}

.role span {
  font-size:
    0.7rem;

  line-height:
    1.5;

  color:
    #89949c;

  margin-top:
    6px;
}

.role.light span {
  color:
    #5d625f;
}

.role:hover {
  box-shadow:
    inset
    0
    -3px
    #d8544d;
}

/* =========================================================
   PUBLIC REPORT
   ========================================================= */

.public-page,
.receipt-wrap {
  background:
    #efebe3;

  color:
    #1d2022;

  min-height:
    calc(
      100vh -
      72px
    );

  padding:
    30px;
}

.public-page {
  max-width:
    1360px;

  margin:
    auto;
}

.public-head {
  border:
    1px solid #d1ccc2;

  background:
    #e8e3da;

  padding:
    30px
    38px
    0;
}

.public-kicker {
  display:
    flex;

  justify-content:
    space-between;

  font:
    700
    0.62rem
    Consolas,
    monospace;

  letter-spacing:
    0.08em;

  color:
    #656762;
}

.public-kicker
span:first-child {
  color:
    #9b302d;
}

.public-title {
  display:
    grid;

  grid-template-columns:
    1.5fr
    0.5fr;

  gap:
    30px;

  align-items:
    end;

  margin-top:
    28px;
}

.public-title h1 {
  font:
    500
    clamp(
      2.7rem,
      5vw,
      5.6rem
    )/.95
    Georgia,
    serif;

  letter-spacing:
    -0.05em;

  margin:
    0
    0
    10px;
}

.public-title p {
  color:
    #62645f;

  max-width:
    700px;

  line-height:
    1.6;
}

.prototype-note {
  border-left:
    3px solid #9b302d;

  padding:
    12px
    14px;

  background:
    #f7f3ec;

  display:
    grid;

  gap:
    4px;

  font-size:
    0.68rem;
}

.prototype-note span {
  color:
    #6e706b;
}

.step-rail {
  display:
    grid;

  grid-template-columns:
    repeat(
      4,
      1fr
    );

  margin-top:
    28px;

  border-top:
    1px solid #cbc6bd;
}

.step-rail span {
  padding:
    12px
    0;

  font-size:
    0.64rem;

  text-transform:
    uppercase;

  color:
    #6d6e69;

  font-weight:
    700;
}

.step-rail b {
  font-family:
    Consolas,
    monospace;

  color:
    #9b302d;

  margin-right:
    8px;
}

.public-layout {
  display:
    grid;

  grid-template-columns:
    minmax(
      0,
      1fr
    )
    330px;

  border:
    1px solid #d1ccc2;

  border-top:
    0;
}

.public-form {
  background:
    #faf7f1;

  padding:
    0
    38px
    38px;
}

.form-error {
  margin-top:
    24px;

  padding:
    12px;

  border:
    1px solid #d5aaa5;

  border-left:
    4px solid #a63430;

  background:
    #fff0ed;

  color:
    #7f2926;

  font-size:
    0.73rem;
}

.form-section {
  padding:
    34px
    0;

  border-bottom:
    1px solid #d9d4ca;
}

.form-section
> header {
  display:
    grid;

  grid-template-columns:
    40px
    1fr;

  gap:
    10px;

  margin-bottom:
    20px;
}

.form-section
> header
> span {
  font:
    700
    0.68rem
    Consolas,
    monospace;

  color:
    #9b302d;

  padding-top:
    5px;
}

.form-section h2 {
  font:
    600
    1.45rem
    Georgia,
    serif;

  margin:
    0;
}

.form-section p {
  margin:
    3px
    0
    0;

  color:
    #757570;

  font-size:
    0.69rem;
}

/* TYPES */

.type-grid {
  display:
    grid;

  grid-template-columns:
    repeat(
      3,
      1fr
    );

  gap:
    8px;
}

.type-card {
  min-height:
    132px;

  padding:
    14px;

  border:
    1px solid #d0cbc1;

  background:
    #f5f0e8;

  text-align:
    left;

  display:
    flex;

  flex-direction:
    column;

  align-items:
    flex-start;

  color:
    #25282a;

  border-radius:
    0;
}

.type-card:hover {
  background:
    #fffdf8;

  border-color:
    #9f9a91;
}

.type-card.selected {
  background:
    #fffdf8;

  border-color:
    #96332f;

  box-shadow:
    inset
    4px
    0
    #96332f;
}

.type-card small {
  font:
    700
    0.58rem
    Consolas,
    monospace;

  color:
    #96332f;
}

.type-card b {
  margin-top:
    auto;

  font-size:
    0.79rem;
}

.type-card span {
  font-size:
    0.62rem;

  color:
    #77746f;

  line-height:
    1.4;

  margin-top:
    5px;
}

.type-card i {
  font:
    700
    0.51rem
    Consolas,
    monospace;

  color:
    #9a9690;

  margin-top:
    8px;

  font-style:
    normal;
}

.type-card.selected i {
  color:
    #96332f;
}

/* FIELDS */

.field-grid {
  display:
    grid;

  gap:
    12px;
}

.field-grid.two {
  grid-template-columns:
    1fr
    0.62fr;
}

.field-grid label,
.full-field {
  display:
    grid;

  gap:
    7px;

  color:
    #5c5d59;

  font-size:
    0.63rem;

  font-weight:
    800;

  text-transform:
    uppercase;

  letter-spacing:
    0.05em;

  margin-bottom:
    12px;
}

.field-grid input,
.full-field input,
.full-field select,
.full-field textarea {
  min-height:
    45px;

  border:
    1px solid #c6c1b7;

  background:
    #fffdf9;

  color:
    #1d2022;

  padding:
    10px
    12px;

  border-radius:
    0;

  outline:
    none;
}

.full-field textarea {
  min-height:
    115px;

  resize:
    vertical;
}

.counter {
  display:
    grid;

  grid-template-columns:
    44px
    1fr
    44px;
}

.counter button,
.counter input {
  border:
    1px solid #c6c1b7;

  background:
    #fffdf9;

  min-height:
    45px;

  color:
    #1d2022;
}

.counter input {
  text-align:
    center;

  border-left:
    0;

  border-right:
    0;
}

.mini-label {
  display:
    flex;

  justify-content:
    space-between;

  margin:
    8px
    0;

  font-size:
    0.68rem;
}

.mini-label span {
  color:
    #85827c;

  font-size:
    0.61rem;
}

.chips {
  display:
    flex;

  flex-wrap:
    wrap;

  gap:
    7px;
}

.chips button {
  border:
    1px solid #c6c1b7;

  background:
    transparent;

  color:
    #5d5c58;

  border-radius:
    999px;

  padding:
    8px
    11px;

  font-size:
    0.66rem;

  text-transform:
    capitalize;
}

.chips button.active {
  background:
    #31373b;

  color:
    #fff;

  border-color:
    #31373b;
}

.condition-grid {
  display:
    grid;

  grid-template-columns:
    1fr
    1fr;

  gap:
    8px;

  margin-top:
    17px;
}

.condition-grid
> button {
  border:
    1px solid #d0cbc1;

  background:
    #f5f0e8;

  color:
    #292b2d;

  padding:
    12px;

  text-align:
    left;

  display:
    grid;

  grid-template-columns:
    22px
    1fr;

  gap:
    10px;

  border-radius:
    0;
}

.condition-grid
> button
> i {
  width:
    20px;

  height:
    20px;

  border:
    1px solid #aaa69e;

  display:
    grid;

  place-items:
    center;

  font-style:
    normal;
}

.condition-grid
> button
span {
  display:
    grid;
}

.condition-grid b {
  font-size:
    0.69rem;
}

.condition-grid small {
  color:
    #76736d;

  font-size:
    0.6rem;

  margin-top:
    4px;
}

.condition-grid
button.active {
  background:
    #fff6f2;

  border-color:
    #9b302d;
}

.condition-grid
button.active i {
  background:
    #9b302d;

  color:
    #fff;

  border-color:
    #9b302d;
}

/* LOCATION */

.loc-row {
  display:
    grid;

  grid-template-columns:
    1fr
    auto;

  gap:
    8px;

  margin-bottom:
    12px;
}

.gps {
  min-height:
    62px;

  background:
    #30373b;

  color:
    #fff;

  border:
    1px solid #30373b;

  border-radius:
    0;

  display:
    grid;

  grid-template-columns:
    28px
    1fr;

  gap:
    10px;

  align-items:
    center;

  text-align:
    left;

  padding:
    10px
    13px;
}

.gps
> span:last-child {
  display:
    grid;
}

.gps b {
  font-size:
    0.71rem;
}

.gps small {
  font-size:
    0.59rem;

  color:
    #c4cbd0;

  margin-top:
    3px;
}

.target {
  width:
    20px;

  height:
    20px;

  border:
    1px solid #dce1e4;

  border-radius:
    50%;

  position:
    relative;
}

.target::before,
.target::after {
  content:
    "";

  position:
    absolute;

  background:
    #dce1e4;
}

.target::before {
  width:
    1px;

  height:
    28px;

  left:
    9px;

  top:
    -5px;
}

.target::after {
  height:
    1px;

  width:
    28px;

  top:
    9px;

  left:
    -5px;
}

.find {
  border:
    1px solid #aaa59c;

  background:
    transparent;

  color:
    #303235;

  padding:
    0
    18px;

  border-radius:
    0;

  font-size:
    0.66rem;

  font-weight:
    800;
}

.coords {
  border-top:
    1px dashed #d0cbc2;
}

.coords summary {
  padding:
    11px
    0;

  cursor:
    pointer;

  color:
    #686964;

  font-size:
    0.64rem;

  font-weight:
    700;
}

/* UPLOAD */

.upload {
  min-height:
    86px;

  border:
    1px dashed #a8a399;

  background:
    #f3eee6;

  display:
    grid;

  grid-template-columns:
    36px
    1fr;

  align-items:
    center;

  gap:
    12px;

  padding:
    13px;

  cursor:
    pointer;
}

.upload input {
  display:
    none;
}

.upload
> b {
  width:
    32px;

  height:
    32px;

  border:
    1px solid #aaa59c;

  display:
    grid;

  place-items:
    center;

  font-size:
    1.1rem;
}

.upload span {
  display:
    grid;
}

.upload strong {
  font-size:
    0.71rem;
}

.upload small {
  color:
    #77746e;

  font-size:
    0.6rem;

  margin-top:
    3px;
}

.preview {
  width:
    100%;

  max-height:
    320px;

  object-fit:
    cover;

  margin-top:
    10px;

  border:
    1px solid #c8c3b9;
}

.submit-row {
  display:
    flex;

  align-items:
    center;

  justify-content:
    space-between;

  gap:
    20px;

  padding-top:
    26px;
}

.submit-row
> span {
  display:
    grid;
}

.submit-row b {
  font-size:
    0.73rem;
}

.submit-row small {
  color:
    #77746e;

  font-size:
    0.61rem;

  margin-top:
    3px;
}

.submit-row
> button,
.primary,
.primary-btn,
.dispatch {
  border:
    1px solid #96332f;

  background:
    #9b302d;

  color:
    #fff;

  padding:
    12px
    18px;

  border-radius:
    0;

  font-weight:
    800;

  font-size:
    0.69rem;
}

/* LIVE SUMMARY */

.live-summary {
  background:
    #20262a;

  color:
    #ecf0f2;

  padding:
    22px;

  position:
    sticky;

  top:
    72px;

  min-height:
    560px;
}

.summary-title {
  display:
    flex;

  justify-content:
    space-between;

  align-items:
    baseline;

  padding-bottom:
    15px;

  border-bottom:
    1px solid #394147;
}

.summary-title b {
  font:
    700
    0.59rem
    Consolas,
    monospace;

  letter-spacing:
    0.07em;
}

.summary-title span {
  font-size:
    0.55rem;

  color:
    #909a9f;
}

.priority {
  padding:
    20px
    0
    12px;

  display:
    grid;

  grid-template-columns:
    1fr
    auto;

  align-items:
    end;
}

.priority small {
  grid-column:
    1 / -1;

  color:
    #929ca1;

  font-size:
    0.58rem;

  text-transform:
    uppercase;
}

.priority
> b {
  font:
    500
    2rem
    Georgia,
    serif;
}

.priority
> strong {
  font:
    500
    1.45rem
    Consolas,
    monospace;
}

.priority
> strong i {
  font-size:
    0.54rem;

  color:
    #8f999e;

  font-style:
    normal;
}

.bar,
.risk-line,
.mini-bar {
  height:
    3px;

  background:
    #3b4348;

  overflow:
    hidden;
}

.bar i,
.risk-line i,
.mini-bar i {
  display:
    block;

  height:
    100%;

  background:
    #b9443f;
}

.fact {
  display:
    flex;

  justify-content:
    space-between;

  gap:
    12px;

  padding:
    9px
    0;

  border-bottom:
    1px solid #373f44;
}

.fact span {
  font-size:
    0.59rem;

  color:
    #90999e;
}

.fact b {
  font-size:
    0.64rem;

  text-align:
    right;

  line-height:
    1.4;
}

.factor-box {
  margin-top:
    15px;

  border-top:
    1px solid #3a4247;
}

.factor-box summary {
  padding:
    12px
    0;

  cursor:
    pointer;

  font-size:
    0.62rem;
}

.factor-box
> div {
  display:
    flex;

  justify-content:
    space-between;

  color:
    #a4adb2;

  font-size:
    0.59rem;

  padding:
    4px
    0;
}

.next-note {
  margin-top:
    17px;

  border-left:
    2px solid #a53b36;

  background:
    #293035;

  padding:
    12px;
}

.next-note b {
  font-size:
    0.63rem;
}

.next-note p {
  font-size:
    0.59rem;

  color:
    #a9b2b6;

  line-height:
    1.5;
}

/* =========================================================
   RECEIPT
   ========================================================= */

.receipt-wrap {
  display:
    grid;

  place-items:
    center;
}

.receipt {
  width:
    min(
      820px,
      100%
    );

  border:
    1px solid #ccc7bd;

  background:
    #fffdf9;
}

.receipt
> header {
  height:
    48px;

  display:
    grid;

  grid-template-columns:
    26px
    1fr
    auto;

  align-items:
    center;

  gap:
    10px;

  padding:
    0
    15px;

  border-bottom:
    1px solid #d7d2c8;

  font:
    700
    0.6rem
    Consolas,
    monospace;

  color:
    #5e605c;
}

.check {
  width:
    22px;

  height:
    22px;

  display:
    grid;

  place-items:
    center;

  background:
    #346849;

  color:
    white;
}

.receipt-main {
  padding:
    34px
    42px;
}

.receipt-main p {
  font-size:
    0.64rem;

  color:
    #7a7974;
}

.receipt-main h1 {
  font:
    600
    clamp(
      1.8rem,
      4vw,
      3rem
    )
    Consolas,
    monospace;

  margin:
    6px
    0;

  color:
    #1b1e20;

  word-break:
    break-all;
}

.receipt-main span {
  font-size:
    0.71rem;

  color:
    #666762;
}

.receipt-grid {
  display:
    grid;

  grid-template-columns:
    1fr
    1fr;

  border-top:
    1px solid #d7d2c8;

  border-bottom:
    1px solid #d7d2c8;
}

.receipt-grid .fact {
  display:
    grid;

  padding:
    15px
    18px;

  border-right:
    1px solid #ddd8cf;

  border-bottom:
    1px solid #ddd8cf;
}

.receipt-grid
.fact b {
  text-align:
    left;

  color:
    #242628;
}

.public-warning {
  margin:
    20px
    42px
    0;

  border-left:
    3px solid #a43a35;

  background:
    #f4ede6;

  color:
    #6c5b57;

  padding:
    12px;

  font-size:
    0.65rem;
}

.receipt footer {
  display:
    flex;

  gap:
    8px;

  padding:
    22px
    42px
    34px;
}

.receipt footer button {
  border:
    1px solid #aaa59c;

  background:
    transparent;

  padding:
    11px
    15px;
}

/* =========================================================
   TRACK
   ========================================================= */

.narrow {
  max-width:
    900px;

  margin:
    auto;

  padding:
    42px
    24px;
}

.empty,
.track-card {
  border:
    1px solid var(--line);

  background:
    #10161b;

  padding:
    36px;
}

.empty h1,
.track-card h1 {
  font:
    500
    2.5rem
    Georgia,
    serif;

  margin:
    10px
    0;
}

.empty p,
.track-card
> p {
  color:
    #8e989f;
}

.timeline {
  display:
    grid;

  grid-template-columns:
    repeat(
      5,
      1fr
    );

  margin:
    32px
    0;
}

.timeline
> div {
  display:
    grid;

  justify-items:
    center;

  text-align:
    center;

  color:
    #68747d;
}

.timeline i {
  width:
    28px;

  height:
    28px;

  border:
    1px solid #44505a;

  display:
    grid;

  place-items:
    center;

  border-radius:
    50%;

  font:
    700
    0.6rem
    Consolas,
    monospace;

  font-style:
    normal;
}

.timeline span {
  display:
    grid;

  margin-top:
    8px;
}

.timeline b {
  font-size:
    0.64rem;
}

.timeline small {
  font-size:
    0.54rem;
}

.timeline
> div.done i {
  border-color:
    #60b87a;

  color:
    #76cf90;
}

.track-facts {
  display:
    grid;

  grid-template-columns:
    1fr
    1fr;
}

.primary-btn {
  margin-top:
    20px;
}

/* =========================================================
   COMMAND CENTER
   ========================================================= */

.command-page,
.sim-page,
.relocation-page {
  padding:
    28px;

  max-width:
    1600px;

  margin:
    auto;
}

.command-head,
.page-title {
  display:
    flex;

  justify-content:
    space-between;

  align-items:
    end;

  gap:
    22px;

  padding:
    10px
    0
    24px;
}

.command-head h1,
.page-title h1 {
  font:
    500
    clamp(
      2.3rem,
      4vw,
      4.6rem
    )/1
    Georgia,
    serif;

  margin:
    8px
    0
    5px;

  letter-spacing:
    -0.045em;
}

.command-head p,
.page-title p {
  margin:
    0;

  color:
    #85919a;
}

.head-actions {
  display:
    flex;

  gap:
    8px;
}

.head-actions button,
.head-actions a {
  border:
    1px solid #35404a;

  background:
    #12181d;

  color:
    #dce2e5;

  padding:
    10px
    13px;

  font-size:
    0.64rem;
}

.metrics {
  display:
    grid;

  grid-template-columns:
    repeat(
      6,
      1fr
    );

  border-left:
    1px solid var(--line);

  border-top:
    1px solid var(--line);
}

.metric {
  min-height:
    82px;

  padding:
    13px;

  border-right:
    1px solid var(--line);

  border-bottom:
    1px solid var(--line);

  background:
    #11171c;

  display:
    grid;

  align-content:
    space-between;
}

.metric span {
  font-size:
    0.57rem;

  text-transform:
    uppercase;

  color:
    #818c94;

  letter-spacing:
    0.05em;
}

.metric b {
  font:
    500
    1.45rem
    Consolas,
    monospace;
}

.ops-grid {
  display:
    grid;

  grid-template-columns:
    280px
    minmax(
      500px,
      1fr
    )
    340px;

  min-height:
    620px;

  border-left:
    1px solid var(--line);

  margin-top:
    16px;
}

.incident-rail,
.intel-rail,
.map-panel {
  border-right:
    1px solid var(--line);

  border-bottom:
    1px solid var(--line);

  background:
    #0f151a;
}

.incident-rail
> header,
.panel-cap {
  height:
    42px;

  display:
    flex;

  align-items:
    center;

  justify-content:
    space-between;

  padding:
    0
    12px;

  border-top:
    1px solid var(--line);

  border-bottom:
    1px solid var(--line);

  font-size:
    0.59rem;

  color:
    #8d989f;
}

.incident-rail
> button {
  width:
    100%;

  padding:
    13px;

  background:
    #10161b;

  color:
    #dfe5e8;

  border:
    0;

  border-bottom:
    1px solid #252e35;

  text-align:
    left;
}

.incident-rail
> button.active {
  background:
    #171f25;

  box-shadow:
    inset
    3px
    0
    #d8544d;
}

.incident-rail
> button
> div {
  display:
    flex;

  gap:
    7px;

  align-items:
    center;
}

.incident-rail
> button small {
  margin-left:
    auto;

  color:
    #69757e;
}

.incident-rail
> button strong {
  display:
    block;

  margin-top:
    9px;

  font-size:
    0.74rem;
}

.incident-rail
> button p {
  margin:
    4px
    0;

  color:
    #7d8991;

  font-size:
    0.61rem;
}

.incident-rail footer {
  display:
    flex;

  justify-content:
    space-between;

  font-size:
    0.55rem;

  margin-top:
    10px;
}

.dot {
  width:
    7px;

  height:
    7px;

  border-radius:
    50%;

  background:
    #75818a;
}

.dot.danger {
  background:
    #e55750;
}

.dot.warn {
  background:
    #dca84e;
}

.rail-empty,
.field-empty {
  padding:
    24px;

  display:
    grid;

  gap:
    6px;

  color:
    #808b93;
}

.rail-empty b,
.field-empty b {
  color:
    #cbd2d6;
}

/* =========================================================
   MAP
   ========================================================= */

.map-panel {
  position:
    relative;
}

.leaflet-host {
  height:
    570px;

  background:
    #0d1216;
}

.map-status {
  height:
    35px;

  display:
    flex;

  gap:
    8px;

  align-items:
    center;

  padding:
    0
    11px;

  border-top:
    1px solid var(--line);

  font-size:
    0.56rem;

  color:
    #849099;
}

.truth {
  font:
    700
    0.53rem
    Consolas,
    monospace;

  padding:
    3px
    5px;

  border:
    1px solid #42677c;

  color:
    #79bce0;
}

.map-legend {
  height:
    38px;

  display:
    flex;

  align-items:
    center;

  gap:
    18px;

  padding:
    0
    12px;

  border-top:
    1px solid var(--line);

  font-size:
    0.55rem;

  color:
    #87939b;
}

.map-legend span {
  display:
    flex;

  gap:
    6px;

  align-items:
    center;
}

.map-legend i {
  width:
    8px;

  height:
    8px;

  border:
    2px solid #fff;

  border-radius:
    50%;
}

.map-legend .incident {
  border-color:
    #e55750;
}

.map-legend .resource {
  border-color:
    #55a8d8;
}

.map-legend .risk {
  border-color:
    #c94f46;
}

/* =========================================================
   INTELLIGENCE
   ========================================================= */

.intel-rail {
  padding:
    14px;

  overflow:
    auto;

  max-height:
    655px;
}

.incident-title {
  display:
    grid;

  grid-template-columns:
    72px
    1fr;

  gap:
    12px;
}

.severity-box {
  height:
    72px;

  display:
    grid;

  place-items:
    center;

  border:
    1px solid #3b444c;

  font:
    700
    0.57rem
    Consolas,
    monospace;
}

.incident-title small {
  color:
    #7b8790;

  font-size:
    0.56rem;
}

.incident-title h2 {
  font:
    500
    1.35rem
    Georgia,
    serif;

  margin:
    4px
    0;
}

.incident-title p {
  margin:
    0;

  color:
    #7d8991;

  font-size:
    0.61rem;
}

.intel-facts {
  margin-top:
    13px;
}

.subhead {
  font:
    700
    0.57rem
    Consolas,
    monospace;

  letter-spacing:
    0.07em;

  color:
    #818d95;

  margin:
    22px
    0
    8px;

  border-top:
    1px solid #2b343b;

  padding-top:
    13px;
}

.response-list
> div {
  display:
    grid;

  grid-template-columns:
    42px
    1fr
    auto;

  gap:
    9px;

  align-items:
    center;

  padding:
    9px
    0;

  border-bottom:
    1px solid #242c32;
}

.unit-code {
  font:
    700
    0.57rem
    Consolas,
    monospace;

  color:
    #6db1d7;
}

.response-list b {
  font-size:
    0.65rem;
}

.response-list small {
  display:
    block;

  color:
    #77838b;

  font-size:
    0.55rem;
}

.response-list strong {
  font:
    600
    0.74rem
    Consolas,
    monospace;
}

.alert {
  padding:
    10px
    11px;

  margin-top:
    7px;

  border-left:
    2px solid #59646c;

  background:
    #151c21;

  display:
    grid;

  gap:
    3px;

  font-size:
    0.6rem;
}

.dispatch {
  width:
    100%;

  margin-top:
    12px;
}

.dispatch:disabled {
  opacity:
    0.55;
}

.hospital {
  display:
    grid;

  gap:
    3px;

  padding:
    9px
    0;

  border-bottom:
    1px solid #262f36;
}

.hospital
> span {
  font:
    700
    0.52rem
    Consolas,
    monospace;

  color:
    #d0a74d;
}

.hospital b {
  font-size:
    0.65rem;
}

.hospital small {
  color:
    #77838b;

  font-size:
    0.55rem;
}

/* =========================================================
   ZONE STRIP
   ========================================================= */

.zone-strip {
  margin-top:
    16px;

  border:
    1px solid var(--line);

  background:
    #10161b;
}

.zone-strip
> header,
.shelter-board
> header {
  display:
    flex;

  justify-content:
    space-between;

  align-items:
    center;

  padding:
    11px
    14px;

  border-bottom:
    1px solid var(--line);

  font-size:
    0.61rem;
}

.zone-strip
> div {
  display:
    grid;

  grid-template-columns:
    repeat(
      4,
      1fr
    );
}

.zone-strip article {
  padding:
    14px;

  border-right:
    1px solid var(--line);
}

.zone-strip article small,
.zone-strip article span,
.zone-strip article footer {
  display:
    block;

  color:
    #7e8991;

  font-size:
    0.56rem;
}

.zone-strip article b {
  display:
    block;

  font-size:
    0.71rem;

  margin:
    7px
    0;
}

.mini-bar {
  margin:
    10px
    0;
}

/* =========================================================
   RESPONDER
   ========================================================= */

.responder-page {
  min-height:
    calc(
      100vh -
      72px
    );

  background:
    #ece8df;

  color:
    #1e2225;

  padding:
    26px;

  display:
    grid;

  place-items:
    start center;
}

.responder-shell {
  width:
    min(
      680px,
      100%
    );

  border:
    1px solid #c8c3b8;

  background:
    #faf7f1;
}

.responder-shell
> header {
  display:
    flex;

  justify-content:
    space-between;

  align-items:
    end;

  padding:
    24px;

  border-bottom:
    1px solid #d4cfc5;
}

.responder-shell h1 {
  font:
    500
    2.5rem
    Georgia,
    serif;

  margin:
    5px
    0;
}

.responder-shell select {
  border:
    1px solid #bdb8ae;

  background:
    #fffdf9;

  padding:
    9px;
}

.unit-banner {
  display:
    grid;

  grid-template-columns:
    repeat(
      3,
      1fr
    );

  border-bottom:
    1px solid #d4cfc5;

  padding:
    0
    20px;
}

.unit-banner .fact,
.field-facts .fact {
  border-color:
    #ddd8ce;
}

.unit-banner .fact span,
.field-facts .fact span {
  color:
    #777a75;
}

.unit-banner .fact b,
.field-facts .fact b {
  color:
    #2b2e30;
}

.field-empty {
  color:
    #6f726f;
}

.field-empty b {
  color:
    #25292b;
}

.field-incident {
  display:
    grid;

  grid-template-columns:
    92px
    1fr;

  gap:
    15px;

  padding:
    22px;
}

.field-severity {
  border:
    1px solid #b5b0a7;

  display:
    grid;

  place-items:
    center;

  padding:
    12px;
}

.field-severity b {
  font:
    600
    1.7rem
    Consolas,
    monospace;
}

.field-incident h2 {
  font:
    500
    1.5rem
    Georgia,
    serif;

  margin:
    4px
    0;
}

.field-incident p {
  color:
    #666963;
}

.field-facts {
  padding:
    0
    22px;
}

.gps-field {
  margin:
    18px
    22px
    0;

  border:
    1px solid #5f686d;

  background:
    #30373b;

  color:
    #fff;

  padding:
    11px;

  width:
    calc(
      100% -
      44px
    );
}

.status-actions {
  display:
    grid;

  grid-template-columns:
    repeat(
      4,
      1fr
    );

  gap:
    7px;

  padding:
    20px
    22px
    24px;
}

.status-actions button {
  border:
    1px solid #aaa59c;

  background:
    #fffdf9;

  padding:
    11px;

  color:
    #2a2e30;
}

.status-actions .resolve {
  background:
    #356c4a;

  color:
    #fff;

  border-color:
    #356c4a;
}

/* =========================================================
   SIMULATOR
   ========================================================= */

.page-title {
  display:
    block;

  max-width:
    900px;
}

.sim-controls {
  display:
    grid;

  grid-template-columns:
    1.2fr
    1.4fr
    1fr
    1fr;

  border-left:
    1px solid var(--line);

  border-top:
    1px solid var(--line);
}

.sim-controls label {
  min-height:
    94px;

  padding:
    13px;

  border-right:
    1px solid var(--line);

  border-bottom:
    1px solid var(--line);

  display:
    grid;

  align-content:
    center;

  gap:
    8px;

  background:
    #11171c;
}

.sim-controls span {
  font-size:
    0.56rem;

  color:
    #828d95;

  text-transform:
    uppercase;
}

.sim-controls input,
.sim-controls select {
  background:
    #0d1216;

  border:
    1px solid #34404a;

  color:
    #e0e6e9;

  padding:
    8px;
}

.toggle-bank {
  border:
    1px solid var(--line);

  margin-top:
    14px;

  background:
    #10161b;
}

.toggle-bank header {
  padding:
    10px
    12px;

  border-bottom:
    1px solid var(--line);

  display:
    flex;

  justify-content:
    space-between;

  font-size:
    0.59rem;

  color:
    #838f97;
}

.toggle-bank
> div {
  display:
    flex;

  flex-wrap:
    wrap;

  gap:
    6px;

  padding:
    12px;
}

.toggle-bank button {
  border:
    1px solid #34404a;

  background:
    #0d1216;

  color:
    #939fa7;

  padding:
    8px
    10px;

  font-size:
    0.58rem;

  text-transform:
    capitalize;
}

.toggle-bank button.active {
  border-color:
    #dca84e;

  background:
    #dca84e12;

  color:
    #e8c882;
}

.compare {
  display:
    grid;

  grid-template-columns:
    1fr
    1fr;

  gap:
    14px;

  margin-top:
    14px;
}

.sim-result {
  border:
    1px solid var(--line);

  background:
    #10161b;

  padding:
    15px;
}

.sim-result
> header {
  display:
    flex;

  justify-content:
    space-between;

  border-bottom:
    1px solid var(--line);

  padding-bottom:
    12px;

  font:
    700
    0.59rem
    Consolas,
    monospace;
}

.sim-result h3 {
  font:
    700
    0.56rem
    Consolas,
    monospace;

  color:
    #828d95;

  letter-spacing:
    0.07em;

  margin-top:
    20px;
}

.recommendations
> div {
  display:
    grid;

  grid-template-columns:
    72px
    1fr;

  gap:
    8px;

  border-left:
    2px solid #58636c;

  background:
    #151c21;

  padding:
    9px;

  margin-top:
    6px;

  font-size:
    0.6rem;
}

.facility-pair {
  display:
    grid;

  grid-template-columns:
    1fr
    1fr;

  gap:
    7px;
}

.facility-pair
> div {
  border:
    1px solid var(--line);

  padding:
    10px;

  display:
    grid;

  gap:
    5px;
}

.facility-pair small {
  color:
    #7f8b93;

  font-size:
    0.54rem;
}

.facility-pair b {
  font-size:
    0.64rem;
}

/* =========================================================
   RELOCATION
   ========================================================= */

.zone-tabs {
  display:
    grid;

  grid-template-columns:
    repeat(
      4,
      1fr
    );

  border-left:
    1px solid var(--line);
}

.zone-tabs button {
  min-height:
    100px;

  border:
    0;

  border-top:
    1px solid var(--line);

  border-right:
    1px solid var(--line);

  border-bottom:
    1px solid var(--line);

  background:
    #10161b;

  color:
    #dce2e5;

  padding:
    13px;

  text-align:
    left;

  display:
    grid;

  align-content:
    space-between;
}

.zone-tabs button.active {
  background:
    #171f25;

  box-shadow:
    inset
    0
    -3px
    #d8544d;
}

.zone-tabs small {
  font:
    700
    0.54rem
    Consolas,
    monospace;

  color:
    #7c8790;
}

.zone-tabs b {
  font-size:
    0.69rem;
}

.zone-tabs span {
  font:
    700
    0.57rem
    Consolas,
    monospace;
}

.relocation-grid {
  display:
    grid;

  grid-template-columns:
    1.2fr
    1fr
    1fr;

  gap:
    14px;

  margin-top:
    14px;
}

.risk-card,
.population-card,
.plan-card,
.shelter-board,
.allocation-board {
  border:
    1px solid var(--line);

  background:
    #10161b;

  padding:
    16px;
}

.risk-card
> header {
  display:
    flex;

  justify-content:
    space-between;

  font-size:
    0.61rem;

  color:
    #8d989f;
}

.risk-score {
  display:
    flex;

  align-items:
    baseline;

  gap:
    6px;

  margin:
    20px
    0;
}

.risk-score strong {
  font:
    500
    4rem
    Consolas,
    monospace;
}

.population-card h2 {
  font:
    500
    3.8rem
    Consolas,
    monospace;

  margin:
    18px
    0
    0;
}

.population-card p,
.plan-card p {
  color:
    #7f8a92;
}

.population-card
> strong {
  display:
    block;

  margin-top:
    16px;

  color:
    #e6b55f;
}

.plan-card h2 {
  font:
    500
    2.1rem
    Georgia,
    serif;

  margin:
    20px
    0
    3px;
}

.shelter-board,
.allocation-board {
  margin-top:
    14px;
}

.shelter-board
> header h2,
.allocation-board h2 {
  font:
    500
    1.6rem
    Georgia,
    serif;

  margin:
    4px
    0;
}

.shelter-list article {
  display:
    grid;

  grid-template-columns:
    44px
    1.4fr
    0.5fr
    0.4fr
    auto;

  gap:
    12px;

  align-items:
    center;

  padding:
    12px
    0;

  border-bottom:
    1px solid var(--line);
}

.shelter-rank {
  font:
    600
    0.8rem
    Consolas,
    monospace;

  color:
    #6f7c85;
}

.shelter-list article
> div:nth-child(2) {
  display:
    grid;
}

.shelter-list article span {
  color:
    #7d8991;

  font-size:
    0.57rem;

  margin-top:
    3px;
}

.shelter-list small {
  font-size:
    0.51rem;

  color:
    #78848c;
}

.shelter-list strong {
  font:
    600
    0.8rem
    Consolas,
    monospace;
}

.shelter-list button {
  border:
    1px solid #39444d;

  background:
    #141b20;

  color:
    #cbd2d6;

  padding:
    7px;

  font-size:
    0.56rem;
}

.allocation-board
> header {
  border-bottom:
    1px solid var(--line);

  padding-bottom:
    10px;
}

.allocation-board
> div {
  display:
    grid;

  grid-template-columns:
    130px
    30px
    1fr
    auto;

  gap:
    12px;

  align-items:
    center;

  padding:
    11px
    0;

  border-bottom:
    1px solid var(--line);

  font-size:
    0.64rem;
}

.allocation-board
> div small {
  color:
    #7f8b93;
}

.capacity-fail {
  border-left:
    3px solid #e55750 !important;

  background:
    #e557500a;

  padding-left:
    12px !important;
}

/* =========================================================
   LEAFLET
   ========================================================= */

.leaflet-popup-content-wrapper,
.leaflet-popup-tip {
  background:
    #11171c !important;

  color:
    #e7ecef !important;

  border-radius:
    2px !important;
}

/* =========================================================
   RESPONSIVE
   ========================================================= */

@media (
  max-width:
  1180px
) {

  .metrics {
    grid-template-columns:
      repeat(
        3,
        1fr
      );
  }

  .ops-grid {
    grid-template-columns:
      240px
      1fr;
  }

  .intel-rail {
    grid-column:
      1 / -1;

    max-height:
      none;
  }

  .zone-strip
  > div {
    grid-template-columns:
      1fr
      1fr;
  }

  .relocation-grid {
    grid-template-columns:
      1fr
      1fr;
  }

  .plan-card {
    grid-column:
      1 / -1;
  }

  .role-grid {
    grid-template-columns:
      1fr
      1fr;
  }

  .sim-controls {
    grid-template-columns:
      1fr
      1fr;
  }
}

@media (
  max-width:
  820px
) {

  .ops-nav {
    padding:
      0
      14px;
  }

  .brand {
    min-width:
      auto;
  }

  .brand small,
  .live {
    display:
      none;
  }

  .ops-nav nav a {
    padding:
      0
      10px;
  }

  .public-page {
    padding:
      12px;
  }

  .public-head {
    padding:
      22px
      18px
      0;
  }

  .public-title {
    grid-template-columns:
      1fr;
  }

  .public-layout {
    grid-template-columns:
      1fr;
  }

  .public-form {
    padding:
      0
      18px
      24px;
  }

  .live-summary {
    position:
      static;
  }

  .type-grid {
    grid-template-columns:
      1fr
      1fr;
  }

  .field-grid.two,
  .condition-grid,
  .loc-row {
    grid-template-columns:
      1fr;
  }

  .metrics {
    grid-template-columns:
      1fr
      1fr;
  }

  .ops-grid {
    grid-template-columns:
      1fr;
  }

  .incident-rail {
    max-height:
      360px;

    overflow:
      auto;
  }

  .leaflet-host {
    height:
      460px;
  }

  .zone-strip
  > div,
  .role-grid,
  .compare,
  .relocation-grid,
  .zone-tabs {
    grid-template-columns:
      1fr;
  }

  .shelter-list article {
    grid-template-columns:
      38px
      1fr
      65px;
  }

  .shelter-list article
  > div:nth-child(4),
  .shelter-list article button {
    display:
      none;
  }

  .allocation-board
  > div {
    grid-template-columns:
      90px
      20px
      1fr;
  }

  .timeline {
    grid-template-columns:
      1fr;
  }

  .timeline
  > div {
    grid-template-columns:
      32px
      1fr;

    justify-items:
      start;

    text-align:
      left;

    margin-bottom:
      12px;
  }

  .track-facts {
    grid-template-columns:
      1fr;
  }

  .status-actions {
    grid-template-columns:
      1fr
      1fr;
  }

  .receipt-grid {
    grid-template-columns:
      1fr;
  }
}

@media (
  max-width:
  520px
) {

  .ops-nav {
    height:
      auto;

    min-height:
      64px;

    flex-wrap:
      wrap;

    padding:
      10px
      12px;
  }

  .ops-nav nav {
    order:
      3;

    width:
      100%;

    height:
      42px;

    border-top:
      1px solid #283038;
  }

  .ops-nav nav a {
    flex:
      1;

    padding:
      0
      8px;

    font-size:
      0.57rem;
  }

  .landing {
    padding:
      16px;
  }

  .hero {
    padding:
      28px
      20px;

    min-height:
      400px;
  }

  .role-grid,
  .type-grid,
  .metrics,
  .sim-controls,
  .facility-pair {
    grid-template-columns:
      1fr;
  }

  .public-title h1 {
    font-size:
      2.6rem;
  }

  .step-rail {
    overflow:
      auto;

    grid-template-columns:
      repeat(
        4,
        110px
      );
  }

  .receipt-wrap {
    padding:
      12px;
  }

  .receipt-main,
  .receipt footer {
    padding-left:
      20px;

    padding-right:
      20px;
  }

  .public-warning {
    margin-left:
      20px;

    margin-right:
      20px;
  }

  .command-page,
  .sim-page,
  .relocation-page {
    padding:
      14px;
  }

  .command-head {
    align-items:
      start;

    flex-direction:
      column;
  }

  .head-actions {
    width:
      100%;
  }

  .head-actions
  > * {
    flex:
      1;
  }

  .leaflet-host {
    height:
      380px;
  }

  .unit-banner {
    grid-template-columns:
      1fr;
  }

  .status-actions {
    grid-template-columns:
      1fr;
  }

  .allocation-board
  > div {
    grid-template-columns:
      1fr;
  }

  .allocation-board
  > div i {
    display:
      none;
  }
}
`;