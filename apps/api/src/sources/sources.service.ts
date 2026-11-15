import { Injectable, NotFoundException } from '@nestjs/common';
import { env } from '../config/env';
import { loadSources, Source, SourcesFile } from './sources';

/** The list is re-read on every call, so editing the YAML needs no restart. */
@Injectable()
export class SourcesService {
  file(): SourcesFile {
    return loadSources(env().SOURCES_FILE);
  }

  all(): Source[] {
    return this.file().documents;
  }

  get(id: string): Source {
    const doc = this.all().find((d) => d.id === id);
    if (!doc) throw new NotFoundException(`Document ${id} is not listed in sources.yaml`);
    return doc;
  }
}
