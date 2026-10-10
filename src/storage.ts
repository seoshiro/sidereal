export const KEYS = {
  draft: "sidereal.draft.v1",
  atlas: "sidereal.atlas.v1",
  language: "sidereal.language",
  lesson: "sidereal.lesson.v2",
} as const;
export class DeviceStore {
  available = true;
  constructor(private getStorage: () => Storage = () => window.localStorage) {}
  read(key: string) {
    try {
      return this.getStorage().getItem(key);
    } catch {
      this.available = false;
      return null;
    }
  }
  write(key: string, value: string) {
    try {
      this.getStorage().setItem(key, value);
      this.available = true;
      return true;
    } catch {
      this.available = false;
      return false;
    }
  }
}
