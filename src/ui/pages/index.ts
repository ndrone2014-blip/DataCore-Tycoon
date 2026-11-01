// Page registry.

import type { App } from '../app';
import { renderDashboard, renderRealEstate, renderConstruction, realEstateChanges } from './dashboard';
import { renderDataCenters, renderEquipment, facilityActions, facilityChanges } from './facilities';
import { renderResearch, renderEmployees, renderContracts, businessActions, businessChanges } from './business';
import { renderFinances, renderCompetitors, renderAchievements, renderSettings, companyActions, companyChanges } from './company';
import { mapActions, mapChanges } from './mapPanel';
import { money } from '../../core/format';

type Handler = (el: HTMLElement, ev: Event) => void;

export interface PageDef {
  id: string;
  title: string;
  icon: string;
  subtitle?: (app: App) => string;
  render: (app: App) => string;
  actions?: (app: App) => Record<string, Handler>;
  changes?: (app: App) => Record<string, Handler>;
}

export const PAGES: PageDef[] = [
  { id: 'dashboard', title: 'Dashboard', icon: 'dashboard', subtitle: (a) => `Welcome back, CEO of ${a.s.company.name}.`, render: renderDashboard },
  { id: 'map', title: 'World Map', icon: 'map', render: () => '', actions: mapActions, changes: mapChanges },
  { id: 'realestate', title: 'Real Estate', icon: 'realestate', subtitle: () => 'Your portfolio and land available in unlocked markets.', render: renderRealEstate, changes: realEstateChanges },
  { id: 'construction', title: 'Construction', icon: 'construction', subtitle: () => 'Active projects, stages and speed-ups.', render: renderConstruction },
  { id: 'datacenters', title: 'Data Centers', icon: 'datacenters', subtitle: () => 'Every operational facility and its management console.', render: renderDataCenters, actions: facilityActions, changes: facilityChanges },
  { id: 'equipment', title: 'Servers & Equipment', icon: 'equipment', subtitle: () => 'Catalog of servers, accelerators, power and cooling.', render: renderEquipment },
  { id: 'research', title: 'Technology Research', icon: 'research', subtitle: () => 'Unlock new hardware and permanent efficiency gains.', render: renderResearch, actions: businessActions, changes: businessChanges },
  { id: 'employees', title: 'Employees', icon: 'employees', subtitle: (a) => `${a.s.employees.length} staff on payroll.`, render: renderEmployees },
  { id: 'contracts', title: 'Customers & Contracts', icon: 'contracts', subtitle: () => 'Sign customers to sell your capacity at premium rates.', render: renderContracts },
  { id: 'finances', title: 'Finances', icon: 'finances', subtitle: (a) => `Lifetime operating profit ${money(a.s.finance.totalRevenue - a.s.finance.totalExpenses)}.`, render: renderFinances, actions: companyActions, changes: companyChanges },
  { id: 'competitors', title: 'Competitors', icon: 'competitors', subtitle: () => 'AI-controlled rivals competing for land, customers and market share.', render: renderCompetitors },
  { id: 'achievements', title: 'Achievements', icon: 'achievements', subtitle: () => 'Missions, daily goals and milestones.', render: renderAchievements },
  { id: 'settings', title: 'Settings', icon: 'settings', subtitle: () => 'Company customization, graphics, audio and saves.', render: renderSettings },
];
