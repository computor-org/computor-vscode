import * as vscode from 'vscode';
import { ComputorApiService } from './ComputorApiService';

export class TutorSelectionService {
  private static instance: TutorSelectionService | null = null;

  // Store context for persistence
  private context: vscode.ExtensionContext;
  // private api: ComputorApiService;

  private courseId: string | null = null;
  private groupId: string | null = null;
  private memberId: string | null = null;
  private courseLabel: string | null = null;
  private groupLabel: string | null = null;
  private memberLabel: string | null = null;

  private emitter = new vscode.EventEmitter<void>();
  public readonly onDidChangeSelection = this.emitter.event;

  private constructor(context: vscode.ExtensionContext, _api: ComputorApiService) {
    this.context = context;
    // Load persisted selection if present
    try {
      const persisted = this.context.globalState.get<any>('computor.tutor.selection');
      if (persisted) {
        this.courseId = persisted.courseId ?? null;
        this.groupId = persisted.groupId ?? null;
        this.memberId = persisted.memberId ?? null;
        this.courseLabel = persisted.courseLabel ?? null;
        this.groupLabel = persisted.groupLabel ?? null;
        this.memberLabel = persisted.memberLabel ?? null;
      }
    } catch {}
  }

  static initialize(context: vscode.ExtensionContext, api: ComputorApiService): TutorSelectionService {
    if (!this.instance) this.instance = new TutorSelectionService(context, api);
    return this.instance;
  }

  static getInstance(): TutorSelectionService {
    if (!this.instance) throw new Error('TutorSelectionService not initialized');
    return this.instance;
  }

  getCurrentCourseId(): string | null { return this.courseId; }
  getCurrentGroupId(): string | null { return this.groupId; }
  getCurrentMemberId(): string | null { return this.memberId; }
  getCurrentCourseLabel(): string | null { return this.courseLabel; }
  getCurrentGroupLabel(): string | null { return this.groupLabel; }
  getCurrentMemberLabel(): string | null { return this.memberLabel; }

  async selectCourse(courseId: string | null, label?: string | null): Promise<void> {
    this.courseId = courseId;
    this.courseLabel = label ?? this.courseLabel ?? null;
    // Reset downstream selections
    this.groupId = null;
    this.memberId = null;
    this.groupLabel = null;
    this.memberLabel = null;
    await this.persist();
    this.emitter.fire();
  }

  async selectGroup(groupId: string | null, label?: string | null): Promise<void> {
    this.groupId = groupId;
    this.groupLabel = label ?? this.groupLabel ?? null;
    // Reset member selection
    this.memberId = null;
    this.memberLabel = null;
    await this.persist();
    this.emitter.fire();
  }

  async selectMember(memberId: string | null, label?: string | null): Promise<void> {
    this.memberId = memberId;
    this.memberLabel = label ?? this.memberLabel ?? null;
    await this.persist();
    this.emitter.fire();
  }

  private async persist(): Promise<void> {
    try {
      await this.context.globalState.update('computor.tutor.selection', {
        courseId: this.courseId,
        groupId: this.groupId,
        memberId: this.memberId,
        courseLabel: this.courseLabel,
        groupLabel: this.groupLabel,
        memberLabel: this.memberLabel
      });
    } catch {}
  }
}