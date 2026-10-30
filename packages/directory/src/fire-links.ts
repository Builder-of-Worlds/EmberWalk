export type FireLink = { id: string; title: string; url: string };

export const FIRE_LINKS: readonly FireLink[] = [
  { id: "defensible-space", title: "CAL FIRE Defensible Space", url: "https://www.fire.ca.gov/dspace" },
  { id: "request-inspection", title: "Request a defensible space inspection", url: "https://survey123.arcgis.com/share/a15c7706b4114e20b39d2a26294338ed" },
  {
    id: "local-contacts",
    title: "Find your Fire Hazard Severity Zone and local public contacts",
    url: "https://calfire-forestry.maps.arcgis.com/apps/instant/lookup/index.html?appid=4663e7486e364f05a933daeae7931125",
  },
];
