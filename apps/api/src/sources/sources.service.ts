import { Injectable, NotFoundException } from '@nestjs/common';
import { env } from '../config/env';
import { loadSources, Source, SourcesFile } from './sources';

/** Список документов перечитывается при каждом обращении: правка YAML не требует перезапуска. */
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
