import test from 'node:test';
import assert from 'node:assert/strict';
import {readCustomerCompletionReviewCommand,readCustomerCompletionReviewResult} from '../../src/domain/care/completion-review.mjs';

const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

test('completion confirmation accepts only an exact empty payload',()=>{
 const command={action:'confirm_completion',payload:{}};
 assert.equal(readCustomerCompletionReviewCommand(command),command);
 for(const value of [{...command,extra:true},{...command,payload:{confirmed:true}},{action:'confirm',payload:{}}])assert.throws(()=>readCustomerCompletionReviewCommand(value));
});

test('completion issue requires one trimmed 10 to 2000 character private detail',()=>{
 const command={action:'report_completion_issue',payload:{details:'  The finish needs another inspection.  '}};
 assert.equal(readCustomerCompletionReviewCommand(command),command);
 for(const value of [{...command,payload:{}},{...command,payload:{details:'too short'}},{...command,payload:{details:'x'.repeat(2001)}},{...command,payload:{details:'Valid private issue',extra:true}}])assert.throws(()=>readCustomerCompletionReviewCommand(value));
});

test('completion review result is exact and action-specific',()=>{
 const result={id,state:'completed',revision:7,review_state:'confirmed',replayed:false};
 assert.equal(readCustomerCompletionReviewResult(result,id,'confirm_completion'),result);
 assert.equal(readCustomerCompletionReviewResult({...result,review_state:'issue_reported',replayed:true},id,'report_completion_issue').replayed,true);
 for(const value of [{...result,state:'in_progress'},{...result,review_state:'issue_reported'},{...result,revision:0},{...result,replayed:'false'},{...result,extra:true}])assert.throws(()=>readCustomerCompletionReviewResult(value,id,'confirm_completion'));
});
