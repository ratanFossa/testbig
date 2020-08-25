module "cookbook_browse_example_workflow" {
  source = "../../tf-modules/workflow"

  prefix          = var.prefix
  name            = "CookbookBrowseExample"
  workflow_config = module.cumulus.workflow_config
  system_bucket   = var.system_bucket
  tags            = local.tags

  state_machine_definition = templatefile(
    "${path.module}/cookbook_browse_example_workflow.asl.json",
    {
      fake_processing_task_arn: module.cumulus.fake_processing_task.task_arn,
      files_to_granules_task_arn: module.cumulus.files_to_granules_task.task_arn,
      move_granules_task_arn: module.cumulus.move_granules_task.task_arn,
      post_to_cmr_task_arn: module.cumulus.post_to_cmr_task.task_arn,
      sync_granule_task_arn: module.cumulus.sync_granule_task.task_arn
    }
  )
}
